/**
 * Ingestion and correlation, tested against recorded responses in
 * scripts/fixtures/. No network: a test that depends on a live endpoint fails
 * for reasons that have nothing to do with the code.
 *
 *   npm run test:ingest
 *
 * Re-record with `npx tsx scripts/record-fixtures.ts` if a provider changes shape.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { parseChart, storeBars, weeklySeries, type ChartResponse } from "../src/lib/ingest/prices";
import { parseUniverse, type UniverseResponse } from "../src/lib/ingest/securities";
import {
  describeFiling,
  estimateNextReport,
  parseSubmissions,
  storeFilings,
  type SubmissionsResponse,
} from "../src/lib/ingest/filings";
import { buildReport, correlate, returnsByWeek, MIN_WEEKS } from "../src/lib/correlation";
import { symbolSeriesId } from "../src/lib/correlation-report";
import {
  createMonitor,
  deleteMonitor,
  describeMonitor,
  evaluateMonitors,
  listMonitors,
  read,
} from "../src/lib/monitors";
import {
  brierScore,
  separated,
  summariseBrier,
  uninformedBrier,
  wilson,
} from "../src/lib/stats";
import { getDecisionNudges } from "../src/lib/nudges";
import { aiConfig, aiEnabled, aiLabel } from "../src/lib/ai-config";
import { closeDb, openDb } from "../src/lib/db";

const FIX = path.join(process.cwd(), "scripts", "fixtures");
// The day the fixtures were recorded. Anything judged against "now" (is the
// next report still ahead, how far below its six-month high) runs on this
// clock, so the checks do not start failing as the calendar moves on.
const RECORDED_AT = "2026-08-06T21:00:00.000Z";
const load = <T,>(name: string): T => JSON.parse(fs.readFileSync(path.join(FIX, name), "utf8")) as T;

let checks = 0;
const failures: string[] = [];
const check = (label: string, fn: () => void) => {
  try {
    fn();
    checks++;
    console.log(`  ok  ${label}`);
  } catch (err) {
    failures.push(`${label} — ${(err as Error).message}`);
    console.log(`  FAIL  ${label}\n        ${(err as Error).message}`);
  }
};

// A throwaway database so the store functions can be exercised for real.
const file = path.join(process.cwd(), "data", "test-ingest.db");
for (const f of [file, `${file}-wal`, `${file}-shm`]) fs.rmSync(f, { force: true });
process.env.ASOF_DB_FILE = file;
const db = openDb(file);
db.prepare("insert into portfolios (id,name,description,createdAt) values ('pf','T',null,?)").run(
  new Date().toISOString()
);
db.prepare(
  `insert into positions (id,portfolioId,ticker,name,assetClass,status,openedAt,closedAt,createdAt,cik,demo)
   values ('pos_t','pf','NVDA','NVIDIA',null,'open',?,null,?, '0001045810',0)`
).run(new Date(Date.now() - 400 * 86_400_000).toISOString(), new Date(Date.now() - 400 * 86_400_000).toISOString());

// A thesis with one assumption, so a monitor firing has something to link to.
db.prepare(
  `insert into thesis_versions
   (id,positionId,versionNo,occurredAt,summary,marketView,variantView,assumptions,catalysts,risks,
    falsifiers,horizon,addCondition,trimCondition,exitCondition,confidence,changeNote,createdAt)
   values ('th_t','pos_t',1,?, 'Test thesis.',null,null,?, '[]','[]','[]',null,null,null,null,3,null,?)`
).run(
  new Date(Date.now() - 400 * 86_400_000).toISOString(),
  JSON.stringify([{ id: "a1", text: "The margin assumption.", status: "intact" }]),
  new Date().toISOString()
);

console.log("price parsing");

check("a daily chart parses to sorted bars and skips Yahoo's null padding", () => {
  const raw = load<ChartResponse>("chart-NVDA-1mo-1d.json");
  const bars = parseChart(raw, "NVDA");
  const closes = raw.chart.result![0].indicators!.quote![0].close!;
  const nulls = closes.filter((c) => c === null || c === undefined).length;
  assert.equal(bars.length, closes.length - nulls, "every non-null close becomes exactly one bar");
  assert.ok(bars.length > 10, `expected a month of trading days, got ${bars.length}`);
  for (const b of bars) {
    assert.ok(Number.isFinite(b.close) && b.close > 0, `bad close ${b.close}`);
    assert.ok(!Number.isNaN(new Date(b.occurredAt).getTime()), `bad date ${b.occurredAt}`);
  }
  for (let i = 1; i < bars.length; i++) {
    assert.ok(bars[i].occurredAt > bars[i - 1].occurredAt, "bars must come out in date order");
  }
});

check("an empty or error response throws rather than returning nothing silently", () => {
  assert.throws(() => parseChart({ chart: { result: [], error: null } }, "X"));
  assert.throws(() =>
    parseChart({ chart: { error: { description: "No data found, symbol may be delisted" } } }, "X")
  );
  // A well-formed response with no rows is legitimately empty, not an error.
  assert.deepEqual(
    parseChart({ chart: { result: [{ timestamp: [], indicators: { quote: [{ close: [] }] } }] } }),
    []
  );
});

check("storing bars is idempotent and never overwrites a manual fill", () => {
  const bars = parseChart(load<ChartResponse>("chart-NVDA-1mo-1d.json"), "NVDA");
  const manualAt = bars[2].occurredAt;
  db.prepare(
    "insert into marks (id,positionId,occurredAt,price,source) values ('mk_manual','pos_t',?,999,'manual')"
  ).run(manualAt);

  storeBars("pos_t", bars);
  const first = db.prepare("select count(*) as n from marks where positionId='pos_t'").get() as {
    n: number;
  };
  storeBars("pos_t", bars);
  const second = db.prepare("select count(*) as n from marks where positionId='pos_t'").get() as {
    n: number;
  };
  assert.equal(first.n, second.n, "re-ingesting the same bars must not duplicate rows");

  const kept = db
    .prepare("select price, source from marks where positionId='pos_t' and occurredAt=?")
    .get(manualAt) as { price: number; source: string };
  assert.equal(kept.price, 999, "a recorded fill is a fact and must survive re-ingestion");
  assert.equal(kept.source, "manual");
});

check("weekly sampling takes one close per week", () => {
  const weekly = weeklySeries("pos_t");
  assert.ok(weekly.length > 0);
  assert.ok(weekly.length <= 6, `a month of dailies should be ~4-5 weeks, got ${weekly.length}`);
  for (let i = 1; i < weekly.length; i++) {
    assert.ok(weekly[i].at > weekly[i - 1].at, "weekly series must be ordered");
  }
});

console.log("\nsecurity universe");

check("the SEC ticker file parses with zero-padded CIKs", () => {
  const rows = parseUniverse(load<UniverseResponse>("sec-company-tickers-slice.json"));
  assert.ok(rows.length >= 8, `expected the slice to hold the demo symbols, got ${rows.length}`);
  const nvda = rows.find((r) => r.ticker === "NVDA");
  assert.ok(nvda, "NVDA must be present");
  assert.equal(nvda!.cik, "0001045810", "CIK must be padded to ten digits");
  assert.match(nvda!.name, /NVIDIA/i);
  for (const r of rows) {
    assert.equal(r.ticker, r.ticker.toUpperCase(), "tickers are normalised to upper case");
    assert.match(r.cik!, /^\d{10}$/);
  }
});

check("malformed universe rows are dropped, not stored half-formed", () => {
  const rows = parseUniverse({
    "0": { cik_str: 1, ticker: "AAA", title: "Fine Co" },
    "1": { cik_str: 2, ticker: "", title: "No ticker" } as never,
    "2": { cik_str: 3, ticker: "CCC", title: "" } as never,
  });
  assert.deepEqual(
    rows.map((r) => r.ticker),
    ["AAA"]
  );
});

console.log("\nfilings");

check("the submissions feed parses newest-first with periods attached", () => {
  const filings = parseSubmissions(load<SubmissionsResponse>("sec-submissions-NVDA.json"));
  assert.ok(filings.length > 50, `expected a real feed, got ${filings.length}`);
  for (let i = 1; i < filings.length; i++) {
    assert.ok(filings[i].filedAt <= filings[i - 1].filedAt, "newest first");
  }
  const q = filings.find((f) => f.form === "10-Q");
  assert.ok(q, "the feed should contain a 10-Q");
  assert.ok(q!.periodEnd, "a periodic filing carries the period it covers");
  assert.match(q!.accession, /\d/);
});

check("an empty feed is empty rather than throwing", () => {
  assert.deepEqual(parseSubmissions({}), []);
  assert.deepEqual(parseSubmissions({ filings: { recent: {} } }), []);
});

check("the next report date is estimated from the median filing gap", () => {
  const filings = parseSubmissions(load<SubmissionsResponse>("sec-submissions-NVDA.json"));
  const est = estimateNextReport(filings)!;
  assert.ok(est, "there is enough history to estimate");
  // A quarterly filer sits near 91 days; anything far outside that is a bug.
  assert.ok(
    est.medianGapDays > 60 && est.medianGapDays < 130,
    `median gap of ${est.medianGapDays} days is not a quarterly cadence`
  );
  assert.ok(est.basedOn >= 3);
  assert.ok(est.nextAt > est.lastFiledAt, "the estimate must be after the last filing");
});

check("the median ignores one late filing rather than being dragged by it", () => {
  const mk = (form: string, filed: string) => ({
    accession: filed,
    form,
    filedAt: `${filed}T12:00:00.000Z`,
    periodEnd: null,
    description: null,
    acceptedAt: `${filed}T12:00:00.000Z`,
    items: [] as string[],
  });
  // Four ~91-day gaps and one 200-day outlier.
  const est = estimateNextReport([
    mk("10-Q", "2026-05-20"),
    mk("10-K", "2026-02-18"),
    mk("10-Q", "2025-11-19"),
    mk("10-Q", "2025-05-03"),
    mk("10-Q", "2025-02-01"),
  ])!;
  assert.equal(est.medianGapDays, 91, `expected the median to hold at 91, got ${est.medianGapDays}`);
});

check("too little history yields no estimate rather than a guess", () => {
  const mk = (filed: string) => ({
    accession: filed,
    form: "10-Q",
    filedAt: `${filed}T12:00:00.000Z`,
    periodEnd: null,
    description: null,
    acceptedAt: `${filed}T12:00:00.000Z`,
    items: [] as string[],
  });
  assert.equal(estimateNextReport([]), null);
  assert.equal(estimateNextReport([mk("2026-01-01"), mk("2025-10-01")]), null);
});

check("filings become ingested evidence exactly once", () => {
  const filings = parseSubmissions(load<SubmissionsResponse>("sec-submissions-NVDA.json"));
  const first = storeFilings("pos_t", "pf", "NVDA", filings, { since: "2000-01-01T00:00:00.000Z" });
  assert.ok(first.evidence > 0, "some filings should be material");
  const second = storeFilings("pos_t", "pf", "NVDA", filings, { since: "2000-01-01T00:00:00.000Z" });
  assert.equal(second.evidence, 0, "re-reading the feed must add nothing");

  const rows = db
    .prepare("select origin, externalId, title from evidence where positionId='pos_t'")
    .all() as Array<{ origin: string; externalId: string; title: string }>;
  assert.ok(rows.length > 0);
  for (const r of rows) {
    assert.equal(r.origin, "ingested", "ingested evidence is marked as such, not passed off as yours");
    assert.match(r.externalId, /^sec:/);
  }
  // Only material forms; a Form 4 for every insider would bury the timeline.
  assert.ok(!rows.some((r) => /\bForm 3\b|\bSCHEDULE 13G\b/.test(r.title)));
});

check("an estimated event is flagged as an estimate and upserted, not duplicated", () => {
  const filings = parseSubmissions(load<SubmissionsResponse>("sec-submissions-NVDA.json"));
  storeFilings("pos_t", "pf", "NVDA", filings, { now: RECORDED_AT });
  storeFilings("pos_t", "pf", "NVDA", filings, { now: RECORDED_AT });
  const evs = db
    .prepare("select id, estimated, externalId, title from events where positionId='pos_t'")
    .all() as Array<{ estimated: number; externalId: string; title: string }>;
  assert.equal(evs.length, 1, "the estimate is one upserted row, not one per run");
  assert.equal(evs[0].estimated, 1);
  assert.match(evs[0].title, /estimated/i, "the UI must be able to say this is derived");
});

check("filing descriptions read as English", () => {
  const at = {
    accession: "a",
    filedAt: "2026-01-01T00:00:00.000Z",
    periodEnd: "2025-12-31",
    description: null,
    acceptedAt: "2026-01-01T00:00:00.000Z",
    items: [] as string[],
  };
  assert.match(describeFiling({ ...at, form: "10-Q" }), /Quarterly report/);
  assert.match(describeFiling({ ...at, form: "10-K" }), /Annual report/);
  assert.match(describeFiling({ ...at, form: "8-K" }), /Material event/);
  assert.match(describeFiling({ ...at, form: "SC 13D" }), /^SC 13D filed/);
});

console.log("\ncorrelation");

const weekly = (sym: string) => {
  const bars = parseChart(load<ChartResponse>(`chart-${sym.replace(/[^A-Za-z0-9]/g, "_")}-2y-1wk.json`));
  return bars.map((b) => ({ at: b.occurredAt, close: b.close }));
};

check("a series is perfectly correlated with itself and inverse to its mirror", () => {
  const a = returnsByWeek(weekly("NVDA"));
  assert.ok(a.size >= MIN_WEEKS, `need at least ${MIN_WEEKS} weeks, got ${a.size}`);
  assert.equal(correlate(a, a).r, 1);

  const mirrored = new Map([...a].map(([k, v]) => [k, -v]));
  assert.equal(correlate(a, mirrored).r, -1);
});

check("a flat series has no correlation rather than NaN", () => {
  const a = returnsByWeek(weekly("NVDA"));
  const flat = new Map([...a].map(([k]) => [k, 0] as [string, number]));
  const { r } = correlate(a, flat);
  assert.equal(r, 0);
  assert.ok(Number.isFinite(r));
});

check("non-overlapping series report zero and an n of zero, not a coincidence", () => {
  const a = new Map([["2020-01", 0.1]]);
  const b = new Map([["2024-30", 0.1]]);
  assert.deepEqual(correlate(a, b), { r: 0, n: 0 });
});

check("the data-centre names cluster and the consumer name sits apart", () => {
  const series = ["NVDA", "CEG", "FCX", "DLR", "NKE"].map((s) => ({
    key: s,
    label: s,
    points: weekly(s),
  }));
  const capex: Array<[string, string, string]> = [
    ["NVDA", "CEG", "Data-center capital expenditure"],
    ["NVDA", "DLR", "Data-center capital expenditure"],
    ["CEG", "DLR", "Data-center capital expenditure"],
  ];
  const report = buildReport(series, capex);
  const r = (a: string, b: string) =>
    report.matrix.find((m) => (m.a === a && m.b === b) || (m.a === b && m.b === a))!.r;

  for (const [a, b] of [
    ["NVDA", "CEG"],
    ["NVDA", "DLR"],
    ["NVDA", "FCX"],
  ] as const) {
    assert.ok(r(a, b) > 0.15, `${a}/${b} should move together, got ${r(a, b)}`);
  }
  // NKE is declared under a different belief and should be visibly looser.
  assert.ok(
    r("NKE", "DLR") < r("NVDA", "CEG"),
    `NKE/DLR (${r("NKE", "DLR")}) should be looser than NVDA/CEG (${r("NVDA", "CEG")})`
  );
  assert.ok(report.weeksCovered >= MIN_WEEKS);
  assert.deepEqual(report.excluded, [], "every fixture has enough history");
});

check("a declared exposure the price does not show is reported as a mismatch", () => {
  // The demo's DLR thesis calls itself a levered short on long rates.
  const series = [
    { key: "DLR", label: "DLR", points: weekly("DLR") },
    { key: "^TNX", label: "10-year yield", points: weekly("^TNX") },
  ];
  const report = buildReport(series, [], [
    { positionKey: "DLR", proxyKey: "^TNX", beliefName: "Long-end interest rates" },
  ]);
  const cell = report.matrix[0];
  assert.ok(Math.abs(cell.r) < 0.15, `expected a weak link, got ${cell.r}`);
  const finding = report.findings.find((f) => f.kind === "proxy-mismatch");
  assert.ok(finding, "a stated exposure absent from the price must be surfaced");
  assert.match(finding!.headline, /Long-end interest rates/);
  assert.ok(finding!.n >= MIN_WEEKS, "and only when the sample supports it");
});

check("findings are withheld when the overlap is too short to mean anything", () => {
  const short = [
    { key: "A", label: "A", points: weekly("NVDA").slice(-10) },
    { key: "B", label: "B", points: weekly("NKE").slice(-10) },
  ];
  const report = buildReport(short, [["A", "B", "Some belief"]]);
  assert.deepEqual(report.findings, [], "no claim from ten weeks of data");
  assert.deepEqual(report.excluded.sort(), ["A", "B"], "and the gap is named rather than hidden");
});

console.log("\nmonitors");

// Real recorded weekly closes, stored under the reserved per-symbol key so the
// monitor engine reads them exactly as it would in the app.
for (const sym of ["NKE", "^TNX"]) {
  storeBars(
    symbolSeriesId(sym),
    parseChart(load<ChartResponse>(`chart-${sym.replace(/[^A-Za-z0-9]/g, "_")}-2y-1wk.json`))
  );
}

check("a level monitor reads the latest close", () => {
  const id = createMonitor({
    positionId: "pos_t",
    kind: "series_level",
    symbol: "^TNX",
    comparator: "above",
    threshold: 999,
    label: "Yield above an impossible level",
  });
  const m = listMonitors().find((x) => x.id === id)!;
  const { value } = read(m);
  assert.ok(value !== null, "there is cached history, so there must be a reading");
  assert.ok(value! > 1 && value! < 20, `a 10-year yield should be single digits, got ${value}`);
  deleteMonitor(id);
});

check("a drawdown monitor measures against the window high, and fires below it", () => {
  const id = createMonitor({
    positionId: "pos_t",
    assumptionId: "a1",
    kind: "drawdown",
    symbol: "NKE",
    comparator: "below",
    threshold: -20,
    windowDays: 180,
    label: "20% below the six-month high",
  });
  const m = listMonitors().find((x) => x.id === id)!;
  const { value, describe } = read(m, new Date(RECORDED_AT));
  assert.ok(value !== null && value! <= 0, "a drawdown is zero or negative");
  assert.match(describe, /high of/);

  const transitions = evaluateMonitors(new Date(RECORDED_AT));
  const mine = transitions.find((t) => t.monitor.id === id);
  assert.ok(mine, "NKE is well below its six-month high, so this must fire");
  assert.equal(mine!.direction, "fired");
  assert.equal(listMonitors().find((x) => x.id === id)!.state, "fired");
  deleteMonitor(id);
});

check("a firing writes ingested evidence against the assumption it speaks for", () => {
  const id = createMonitor({
    positionId: "pos_t",
    assumptionId: "a1",
    kind: "drawdown",
    symbol: "NKE",
    comparator: "below",
    threshold: -5,
    windowDays: 180,
    label: "Test firing",
    meaning: "This is what I said it would mean.",
  });
  evaluateMonitors();
  const ev = db
    .prepare("select * from evidence where externalId like ? order by occurredAt desc limit 1")
    .get(`monitor:${id}:%`) as
    | { origin: string; stance: string; contradictsAssumptionId: string | null; body: string }
    | undefined;
  assert.ok(ev, "a firing must leave a record");
  assert.equal(ev!.origin, "ingested", "marked as found by the engine, not written by the user");
  assert.equal(ev!.stance, "contradicts");
  assert.equal(ev!.contradictsAssumptionId, "a1");
  assert.match(ev!.body, /This is what I said it would mean/, "the interpretation travels with it");
  deleteMonitor(id);
});

check("a monitor that stays fired does not write a second record", () => {
  const id = createMonitor({
    positionId: "pos_t",
    kind: "drawdown",
    symbol: "NKE",
    comparator: "below",
    threshold: -5,
    windowDays: 180,
    label: "Quiet while fired",
  });
  evaluateMonitors();
  const countAfterFirst = (
    db.prepare("select count(*) as n from evidence where externalId like ?").get(`monitor:${id}:%`) as {
      n: number;
    }
  ).n;
  evaluateMonitors();
  evaluateMonitors();
  const countAfterMore = (
    db.prepare("select count(*) as n from evidence where externalId like ?").get(`monitor:${id}:%`) as {
      n: number;
    }
  ).n;
  assert.equal(countAfterFirst, 1);
  assert.equal(countAfterMore, 1, "only transitions are recorded, not every check");
  deleteMonitor(id);
});

check("a monitor with no cached history reads nothing rather than guessing", () => {
  const id = createMonitor({
    positionId: "pos_t",
    kind: "price_level",
    symbol: "NOSUCHSYMBOL",
    comparator: "below",
    threshold: 10,
    label: "Unknown symbol",
  });
  const m = listMonitors().find((x) => x.id === id)!;
  assert.equal(read(m).value, null);
  // And it must not fire on a missing reading.
  const before = listMonitors().find((x) => x.id === id)!.state;
  evaluateMonitors();
  assert.equal(listMonitors().find((x) => x.id === id)!.state, before);
  deleteMonitor(id);
});

check("a deadline monitor counts days past the date", () => {
  const past = createMonitor({
    positionId: "pos_t",
    kind: "deadline",
    symbol: "NKE",
    comparator: "above",
    threshold: Date.now() - 10 * 86_400_000,
    label: "A date ten days gone",
  });
  const future = createMonitor({
    positionId: "pos_t",
    kind: "deadline",
    symbol: "NKE",
    comparator: "above",
    threshold: Date.now() + 10 * 86_400_000,
    label: "A date ten days out",
  });
  const all = listMonitors();
  assert.equal(read(all.find((m) => m.id === past)!).value, 10);
  assert.equal(read(all.find((m) => m.id === future)!).value, -10);
  assert.match(read(all.find((m) => m.id === past)!).describe, /passed 10 days ago/);
  assert.match(read(all.find((m) => m.id === future)!).describe, /10 days remaining/);

  const fired = evaluateMonitors().filter((t) => t.direction === "fired").map((t) => t.monitor.id);
  assert.ok(fired.includes(past), "a date already gone should fire");
  assert.ok(!fired.includes(future), "a date still ahead should not");
  deleteMonitor(past);
  deleteMonitor(future);
});

check("describeMonitor reads as a sentence for every kind", () => {
  const base = { positionId: "pos_t", symbol: "NKE", comparator: "below" as const, label: "x" };
  const cases: Array<[string, RegExp]> = [
    ["price_level", /NKE below 70/],
    ["drawdown", /falls 20% below its 90-day high/],
    ["price_change", /falls more than 20% over 90 days/],
    ["deadline", /passes/],
  ];
  for (const [kind, expected] of cases) {
    const id = createMonitor({
      ...base,
      kind: kind as never,
      threshold: kind === "deadline" ? Date.now() : kind === "price_level" ? 70 : -20,
      windowDays: 90,
    });
    const m = listMonitors().find((x) => x.id === id)!;
    assert.match(describeMonitor(m), expected, `${kind} reads badly: ${describeMonitor(m)}`);
    deleteMonitor(id);
  }
});

console.log("\nstatistics");

check("a Wilson interval stays inside 0-100 and widens as the sample shrinks", () => {
  const wide = wilson(1, 1);
  const narrow = wilson(80, 100);
  assert.ok(wide.low >= 0 && wide.high <= 100);
  // The failure this replaces: a bucket of one at 100% used to report [100,100].
  assert.ok(wide.low < 50, `a single success should not imply certainty, got ${wide.low}`);
  assert.equal(wide.high, 100);
  assert.ok(wide.spread > narrow.spread, "less data must mean a wider interval");
  assert.ok(narrow.low > 65 && narrow.high < 90, `80/100 should be tight, got ${JSON.stringify(narrow)}`);
  assert.deepEqual(wilson(0, 0), { low: 0, high: 100, spread: 50 }, "no data says nothing");
});

check("separated() only reports a difference the intervals support", () => {
  assert.ok(!separated(wilson(5, 9), wilson(7, 9)), "nine decisions cannot separate these");
  assert.ok(separated(wilson(5, 500), wilson(400, 500)), "five hundred can");
});

check("a Brier score rewards a confident correct call over a hedge", () => {
  const confidentRight = brierScore({ Bull: 80, Base: 15, Bear: 5 }, "Bull")!;
  const hedged = brierScore({ Bull: 34, Base: 33, Bear: 33 }, "Bull")!;
  const confidentWrong = brierScore({ Bull: 80, Base: 15, Bear: 5 }, "Bear")!;
  assert.ok(confidentRight < hedged, "being right and sure should score best");
  assert.ok(hedged < confidentWrong, "hedging should beat being confidently wrong");
  assert.ok(confidentRight >= 0 && confidentWrong <= 1);
  // Percentages and fractions must score identically.
  assert.ok(
    Math.abs(brierScore({ Bull: 0.8, Base: 0.15, Bear: 0.05 }, "Bull")! - confidentRight) < 1e-9
  );
});

check("a Brier score is refused rather than guessed when it cannot be computed", () => {
  assert.equal(brierScore({}, "Bull"), null);
  assert.equal(brierScore({ Bull: 50, Bear: 50 }, "Sideways"), null, "unknown outcome");
  assert.equal(brierScore({ Bull: 0, Bear: 0 }, "Bull"), null, "no probability mass");
});

check("skill is measured against knowing nothing, not against zero", () => {
  const perfect = summariseBrier([{ score: 0, outcomes: 3 }])!;
  assert.ok(perfect.skill > 0.9, `a perfect forecast should score near 1, got ${perfect.skill}`);
  const useless = summariseBrier([{ score: uninformedBrier(3), outcomes: 3 }])!;
  assert.ok(Math.abs(useless.skill) < 1e-9, "matching the baseline is zero skill");
  assert.equal(summariseBrier([]), null);
});

console.log("\ndecision-time nudges");

check("adding into a weakening thesis is flagged before the decision is written", () => {
  // Break an assumption on the test position, then ask for nudges on an add.
  db.prepare("update thesis_versions set assumptions=? where id='th_t'").run(
    JSON.stringify([
      { id: "a1", text: "The margin assumption.", status: "broken" },
      { id: "a2", text: "The second assumption.", status: "weakening" },
    ])
  );
  db.prepare("update thesis_versions set addCondition=? where id='th_t'").run(
    "No further adds. I have used my add."
  );
  const nudges = getDecisionNudges("pos_t", "add");
  const ids = nudges.map((n) => n.id);
  assert.ok(ids.includes("nudge_no_add"), "a written 'no further adds' must be surfaced");
  assert.ok(ids.includes("nudge_add_weak"), "two shaky assumptions must be surfaced");
  assert.equal(nudges[0].tone, "stop", "the hardest nudges come first");
  for (const n of nudges) {
    assert.ok(n.headline.length > 0 && n.detail.length > 0);
    // A nudge must never instruct.
    assert.ok(!/\byou should\b|\bwe recommend\b/i.test(`${n.headline} ${n.detail}`));
  }
});

check("holding against your own broken exit condition is flagged", () => {
  db.prepare("update thesis_versions set exitCondition=? where id='th_t'").run(
    "Any falsifier fires, or a1 moving to broken."
  );
  const ids = getDecisionNudges("pos_t", "hold").map((n) => n.id);
  assert.ok(ids.includes("nudge_hold_against_rule"));
});

check("no position means no nudges rather than generic advice", () => {
  assert.deepEqual(getDecisionNudges(null, "add"), []);
  assert.deepEqual(getDecisionNudges("pos_does_not_exist", "add"), []);
});

console.log("\nmodel layer");

check("the model layer is off and inert without a key", () => {
  const saved = {
    a: process.env.ANTHROPIC_API_KEY,
    o: process.env.OPENAI_API_KEY,
    m: process.env.ASOF_AI_MODEL,
  };
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.ASOF_AI_MODEL;
  try {
    assert.equal(aiEnabled(), false);
    assert.equal(aiConfig(), null);
    assert.equal(aiLabel(), null);

    // A key alone is enough; the model id is optional.
    process.env.ANTHROPIC_API_KEY = "test-key-not-real";
    assert.equal(aiEnabled(), true);
    assert.equal(aiConfig()!.provider, "anthropic");
    assert.ok(aiConfig()!.modelId.length > 0, "a default model is chosen");

    // An explicit provider that has no key must not silently fall through.
    process.env.ASOF_AI_MODEL = "openai:gpt-4.1-mini";
    assert.equal(aiEnabled(), false, "naming a provider with no key must disable it");

    process.env.ASOF_AI_MODEL = "anthropic:some-model";
    assert.equal(aiConfig()!.modelId, "some-model");

    process.env.ASOF_AI_MODEL = "nonsense:whatever";
    assert.equal(aiConfig(), null, "an unknown provider is not guessed at");
  } finally {
    if (saved.a === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = saved.a;
    if (saved.o === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = saved.o;
    if (saved.m === undefined) delete process.env.ASOF_AI_MODEL;
    else process.env.ASOF_AI_MODEL = saved.m;
  }
});

// ── the signal spine ──────────────────────────────────────────────────────

import { entryBar, grade, isHit, lastPerDay, sessionEndUtc, type DailyBar } from "../src/lib/grade";
import { dedupeSymbolDays } from "../src/lib/ingest/prices";
import {
  aggregateSignals,
  computeOutcomes,
  outcomesFor,
  recordSignal,
} from "../src/lib/signals";
import { ensureUniverse, readUniverseFile } from "../src/lib/ingest/universe";
import { resetDb } from "../src/lib/db";

console.log("\nsignal spine:");

check("session end is DST-aware", () => {
  assert.equal(sessionEndUtc("2026-07-15"), "2026-07-15T20:00:00.000Z"); // EDT: 4pm = 20:00Z
  assert.equal(sessionEndUtc("2026-01-15"), "2026-01-15T21:00:00.000Z"); // EST: 4pm = 21:00Z
});

/** Weekday-only daily bars from a start date, stamped at 14:30Z like Yahoo's. */
function mkBars(start: string, closes: number[]): DailyBar[] {
  const out: DailyBar[] = [];
  const d = new Date(`${start}T14:30:00.000Z`);
  for (const close of closes) {
    while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
    out.push({ at: d.toISOString(), close });
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

// 2026-07-06 is a Monday. Bars: 7/6, 7/7, 7/8, 7/9, 7/10, 7/13, …
const symBars = mkBars("2026-07-06", [100, 102, 104, 106, 108, 110, 112, 114, 116, 118]);

check("pre-open knowledge enters at that same day's close", () => {
  // Accepted 08:00 ET on 7/7 (12:00Z) — the 7/7 session had not ended.
  assert.equal(entryBar(symBars, "2026-07-07T12:00:00.000Z")!.close, 102);
});
check("intraday knowledge enters at that same day's close", () => {
  assert.equal(entryBar(symBars, "2026-07-07T15:00:00.000Z")!.close, 102);
});
check("after-hours knowledge waits for the next day's close", () => {
  // Accepted 17:30 ET on 7/7 (21:30Z) — after the 20:00Z EDT session end.
  assert.equal(entryBar(symBars, "2026-07-07T21:30:00.000Z")!.close, 104);
});

check("grade computes excess vs the benchmark over the same dates", () => {
  const bench = mkBars("2026-07-06", [200, 200, 200, 200, 200, 210, 210, 210, 210, 210]);
  const g = grade(symBars, bench, "2026-07-06T12:00:00.000Z", 5);
  assert.equal(g.status, "graded");
  if (g.status !== "graded") return;
  // Entry 7/6 (100 vs 200); exit 5 benchmark trading days later = 7/13 (110 vs 210).
  assert.ok(Math.abs(g.signalReturn - 0.1) < 1e-9, `signal ${g.signalReturn}`);
  assert.ok(Math.abs(g.benchmarkReturn - 0.05) < 1e-9, `bench ${g.benchmarkReturn}`);
  assert.ok(Math.abs(g.excessReturn - 0.05) < 1e-9, `excess ${g.excessReturn}`);
});

check("a horizon that has not elapsed is pending, not graded", () => {
  const bench = mkBars("2026-07-06", [200, 201, 202, 203, 204, 205, 206, 207, 208, 209]);
  assert.equal(grade(symBars, bench, "2026-07-06T12:00:00.000Z", 20).status, "pending");
});

check("a missing symbol bar near the exit uses the last print, same shared dates", () => {
  // Symbol skips the 7/13 bar (halt); exit falls back to 7/10's close within the stale limit.
  const gappy = symBars.filter((b) => !b.at.startsWith("2026-07-13"));
  const bench = mkBars("2026-07-06", [200, 200, 200, 200, 200, 210, 210, 210, 210, 210]);
  const g = grade(gappy, bench, "2026-07-06T12:00:00.000Z", 5);
  assert.equal(g.status, "graded");
  if (g.status !== "graded") return;
  assert.ok(Math.abs(g.signalReturn - 0.08) < 1e-9, "exited at 7/10's 108");
});

check("a series that dies before the horizon is ungraded, never guessed", () => {
  const dead = symBars.slice(0, 3); // last print 7/8
  const bench = mkBars("2026-07-06", Array.from({ length: 40 }, (_, i) => 200 + i));
  assert.equal(grade(dead, bench, "2026-07-06T12:00:00.000Z", 20).status, "ungraded");
});

check("a signal older than the price history is ungraded, not entered years late", () => {
  // The live defect: 8-K signals from 2013 were "entered" at the first bar of a
  // 5-year backfill (2021) and graded against prices years after the fact.
  const bench = mkBars("2026-07-06", Array.from({ length: 40 }, (_, i) => 200 + i));
  const g = grade(symBars, bench, "2013-02-05T21:30:00.000Z", 5);
  assert.equal(g.status, "ungraded");
});

check("a signal from just before the history starts still enters at its first close", () => {
  // Friday evening 7/3, history starts Monday 7/6: that close is the real entry.
  const bench = mkBars("2026-07-06", [200, 200, 200, 200, 200, 210, 210, 210, 210, 210]);
  assert.equal(grade(symBars, bench, "2026-07-03T21:30:00.000Z", 5).status, "graded");
});

check("a week-close bar stamped at week start cannot poison the entry price", () => {
  // The live defect: a legacy weekly bar at 04:00 on Monday carrying FRIDAY's
  // close (CEG 2024-09-16: 254.98 vs Monday's real 199.25). One bar per date,
  // latest stamp wins.
  const poisoned: DailyBar[] = [
    { at: "2026-07-06T04:00:00.000Z", close: 254.98 }, // weekly, Friday's close
    { at: "2026-07-06T14:30:00.000Z", close: 199.25 }, // daily, Monday's real close
    { at: "2026-07-07T14:30:00.000Z", close: 201.0 },
  ];
  const clean = lastPerDay(poisoned);
  assert.equal(clean.length, 2);
  assert.equal(clean[0].close, 199.25, "Monday keeps Monday's close");
});

check("dedupeSymbolDays purges the stale twin and keeps the daily bar", () => {
  const sid = symbolSeriesId("TSTDUP");
  storeBars(sid, [
    { occurredAt: "2026-07-06T04:00:00.000Z", close: 254.98 },
    { occurredAt: "2026-07-06T14:30:00.000Z", close: 199.25 },
  ]);
  const purged = dedupeSymbolDays();
  assert.ok(purged >= 1, `purged ${purged}`);
  const rows = db
    .prepare("select price from marks where positionId=? order by occurredAt")
    .all(sid) as Array<{ price: number }>;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].price, 199.25);
});

check("hits follow direction; info signals have none", () => {
  assert.equal(isHit("long", 0.02), true);
  assert.equal(isHit("long", -0.02), false);
  assert.equal(isHit("short", -0.02), true);
  assert.equal(isHit("info", 0.02), null);
});

check("recordSignal is idempotent on externalId", () => {
  const first = recordSignal({
    source: "test", kind: "k_idem", symbol: "TSTA", direction: "long",
    firedAt: "2026-07-06T12:00:00.000Z", knownAt: "2026-07-06T12:00:00.000Z",
    title: "one", externalId: "sig:test:idem",
  });
  const second = recordSignal({
    source: "test", kind: "k_idem", symbol: "TSTA", direction: "long",
    firedAt: "2026-07-06T12:00:00.000Z", knownAt: "2026-07-06T12:00:00.000Z",
    title: "two", externalId: "sig:test:idem",
  });
  assert.ok(first !== null && second === null);
  const n = (db.prepare("select count(*) as n from signals where externalId='sig:test:idem'").get() as { n: number }).n;
  assert.equal(n, 1);
});

check("a stale knownAt is auto-flagged as backfilled; a fresh one is not", () => {
  recordSignal({
    source: "test", kind: "k_bf", symbol: "TSTA", direction: "long",
    firedAt: "2026-07-06T12:00:00.000Z", knownAt: "2026-07-06T12:00:00.000Z",
    title: "old", externalId: "sig:test:old",
  });
  recordSignal({
    source: "test", kind: "k_bf", symbol: "TSTA", direction: "long",
    firedAt: new Date().toISOString(), knownAt: new Date().toISOString(),
    title: "fresh", externalId: "sig:test:fresh",
  });
  const bf = (id: string) =>
    (db.prepare("select backfilled from signals where externalId=?").get(id) as { backfilled: number }).backfilled;
  assert.equal(bf("sig:test:old"), 1);
  assert.equal(bf("sig:test:fresh"), 0);
});

check("computeOutcomes grades elapsed horizons only, and only once", () => {
  // Real series in marks for TSTB and the SPY benchmark: 30 bars each.
  const closes = Array.from({ length: 30 }, (_, i) => 100 + i);
  storeBars(symbolSeriesId("TSTB"), mkBars("2026-05-04", closes).map((b) => ({ occurredAt: b.at, close: b.close })));
  storeBars(symbolSeriesId("SPY"), mkBars("2026-05-04", closes.map((c) => c * 2)).map((b) => ({ occurredAt: b.at, close: b.close })));

  const id = recordSignal({
    source: "test", kind: "k_out", symbol: "TSTB", direction: "long",
    firedAt: "2026-05-04T12:00:00.000Z", knownAt: "2026-05-04T12:00:00.000Z",
    title: "gradeable", externalId: "sig:test:out",
  })!;
  computeOutcomes();
  const horizons = outcomesFor(id).map((o) => o.horizonDays);
  assert.deepEqual(horizons, [5, 20], "5 and 20 elapsed within 30 bars; 60 still pending");

  const before = outcomesFor(id).map((o) => o.computedAt).join("|");
  computeOutcomes();
  assert.equal(outcomesFor(id).map((o) => o.computedAt).join("|"), before, "outcomes are never revised");
});

check("the scorecard refuses backfilled signals; the studies accept them", () => {
  // Same symbol/series, one live-collected (override) and one imported.
  recordSignal({
    source: "test2", kind: "k_agg", symbol: "TSTB", direction: "long",
    firedAt: "2026-05-04T12:00:00.000Z", knownAt: "2026-05-04T12:00:00.000Z",
    title: "live", externalId: "sig:test2:live", backfilled: false,
  });
  recordSignal({
    source: "test2", kind: "k_agg", symbol: "TSTB", direction: "long",
    firedAt: "2026-05-05T12:00:00.000Z", knownAt: "2026-05-05T12:00:00.000Z",
    title: "imported", externalId: "sig:test2:imported", backfilled: true,
  });
  computeOutcomes();

  const score = aggregateSignals("source", { includeBackfilled: false }).find((g) => g.key === "test2");
  assert.equal(score?.total, 1, "scorecard sees only the live signal");
  const study = aggregateSignals("kind", { includeBackfilled: true }).find((g) => g.key === "k_agg");
  assert.equal(study?.total, 2, "studies see both");
  // Rising series beats a rising benchmark equally — excess 0 is not a hit; just
  // assert the hit machinery ran for a directional row.
  const row = study?.rows.find((r) => r.horizonDays === 5);
  assert.ok(row && row.hits !== null && row.hitInterval !== null, "directional rows carry a hit rate");
});

check("a monitor firing lands in the signal feed", () => {
  const monId = createMonitor({
    kind: "price_level", symbol: "TSTB", comparator: "above", threshold: 1,
    label: "test monitor fires",
  });
  evaluateMonitors(new Date("2026-06-16T00:00:00.000Z"));
  const n = (db.prepare("select count(*) as n from signals where source='monitor' and symbol='TSTB'").get() as { n: number }).n;
  assert.ok(n >= 1, "firing emitted a signal");
  deleteMonitor(monId);
});

check("the committed universe list parses and seeds", () => {
  const symbols = readUniverseFile();
  assert.ok(symbols.length >= 80, `expected a real list, got ${symbols.length}`);
  assert.ok(symbols.every((s) => /^[A-Z0-9.\-]+$/.test(s)), "tickers only, no comments");
  const { total } = ensureUniverse();
  assert.equal(total >= symbols.length, true);
  const again = ensureUniverse();
  assert.equal(again.added, 0, "re-seeding adds nothing");
});

// ── insider signals (Form 4) ──────────────────────────────────────────────

console.log("\ninsider signals:");

import {
  parseForm4,
  ownershipXmlName,
  registerBuyFiling,
  syncInsiders,
  LARGE_BUY_USD,
  MIN_BUY_USD,
} from "../src/lib/ingest/insiders";

check("a real Form 4 parses, and a gift (code G) is not a buy", () => {
  const xml = fs.readFileSync(path.join(FIX, "sec-form4.xml"), "utf8");
  const f = parseForm4(xml);
  assert.equal(f.symbol, "NVDA");
  assert.equal(f.issuerName, "NVIDIA CORP");
  assert.equal(f.owners.length, 1);
  assert.equal(f.owners[0].name, "COXE TENCH");
  assert.deepEqual(f.owners[0].roles, ["director"]);
  assert.equal(f.buys.length, 0, "code G (gift) must not count as an open-market buy");
});

check("the ownership XML is found and rendered views are skipped", () => {
  const index = load<{ directory?: { item?: Array<{ name?: string }> } }>("sec-form4-index.json");
  const name = ownershipXmlName(index);
  assert.ok(name && name.endsWith(".xml") && !/^xsl/i.test(name), `got ${name}`);
});

/** A minimal synthetic Form 4 in the real schema shape. */
function form4(opts: { owner: string; rows: Array<{ code: string; date: string; shares: number; price?: number }> }) {
  const rows = opts.rows
    .map(
      (r) => `<nonDerivativeTransaction>
        <transactionDate><value>${r.date}</value></transactionDate>
        <transactionCoding><transactionCode>${r.code}</transactionCode></transactionCoding>
        <transactionAmounts>
          <transactionShares><value>${r.shares}</value></transactionShares>
          <transactionPricePerShare>${r.price !== undefined ? `<value>${r.price}</value>` : `<footnoteId id="F1"/>`}</transactionPricePerShare>
        </transactionAmounts>
      </nonDerivativeTransaction>`
    )
    .join("");
  return parseForm4(`<ownershipDocument>
    <issuer><issuerTradingSymbol>TSTC</issuerTradingSymbol><issuerName>Test Corp</issuerName></issuer>
    <reportingOwner><reportingOwnerId><rptOwnerName>${opts.owner}</rptOwnerName></reportingOwnerId>
      <reportingOwnerRelationship><isDirector>1</isDirector></reportingOwnerRelationship></reportingOwner>
    <nonDerivativeTable>${rows}</nonDerivativeTable>
  </ownershipDocument>`);
}

check("split lots aggregate before the threshold, and footnoted lots carry no notional", () => {
  const f = form4({
    owner: "DOE JANE",
    rows: [
      { code: "P", date: "2026-06-01", shares: 300, price: 50 }, // $15k
      { code: "P", date: "2026-06-01", shares: 300, price: 55 }, // $16.5k — together $31.5k ≥ MIN
      { code: "P", date: "2026-06-01", shares: 100 }, // footnote-only price: shares counted, no notional
      { code: "S", date: "2026-06-01", shares: 900, price: 50 }, // a sale never counts
    ],
  });
  assert.equal(f.buys.length, 1, "one aggregated buy per date");
  const b = f.buys[0];
  assert.equal(b.shares, 700);
  assert.equal(b.pricedShares, 600);
  assert.ok(Math.abs(b.notional - 31_500) < 1e-6, `notional ${b.notional}`);
  assert.ok(b.notional >= MIN_BUY_USD, "aggregate clears the floor thirty split fills would each miss");
});

check("a large buy emits one signal; re-registering is a no-op", () => {
  const parsed = form4({
    owner: "BIGBUYER AL",
    rows: [{ code: "P", date: "2026-06-02", shares: 3000, price: 100 }], // $300k ≥ LARGE
  });
  assert.ok(parsed.buys[0].notional >= LARGE_BUY_USD);
  const first = registerBuyFiling("TSTC", "acc-large-1", "2026-06-03T10:00:00.000Z", parsed);
  assert.equal(first.signals, 1);
  const again = registerBuyFiling("TSTC", "acc-large-1", "2026-06-03T10:00:00.000Z", parsed);
  assert.equal(again.signals, 0, "externalId dedupe");
});

check("a second distinct insider completes a cluster — once, and growth does not re-mint it", () => {
  // BIGBUYER AL bought 6/2 (above). A second owner inside 14 days completes it.
  const two = registerBuyFiling(
    "TSTC",
    "acc-c2",
    "2026-06-05T10:00:00.000Z",
    form4({ owner: "SECOND BOB", rows: [{ code: "P", date: "2026-06-04", shares: 600, price: 50 }] })
  );
  const clusters = () =>
    (db.prepare("select count(*) as n from signals where kind='insider_cluster_buy' and symbol='TSTC'").get() as { n: number }).n;
  assert.equal(two.signals, 1, "the threshold-crossing filing emits the cluster");
  assert.equal(clusters(), 1);

  // A third owner three days later grows the cluster — no second signal.
  registerBuyFiling(
    "TSTC",
    "acc-c3",
    "2026-06-08T10:00:00.000Z",
    form4({ owner: "THIRD CAROL", rows: [{ code: "P", date: "2026-06-07", shares: 600, price: 50 }] })
  );
  assert.equal(clusters(), 1, "growth inside the window does not re-mint");

  // Well outside the window, a fresh pair mints a fresh cluster.
  registerBuyFiling(
    "TSTC",
    "acc-c4",
    "2026-07-20T10:00:00.000Z",
    form4({ owner: "FOURTH DAN", rows: [{ code: "P", date: "2026-07-18", shares: 600, price: 50 }] })
  );
  registerBuyFiling(
    "TSTC",
    "acc-c5",
    "2026-07-25T10:00:00.000Z",
    form4({ owner: "FIFTH EVE", rows: [{ code: "P", date: "2026-07-24", shares: 600, price: 50 }] })
  );
  assert.equal(clusters(), 2, "a new window can cluster again");
});

// ── 8-K event signals ─────────────────────────────────────────────────────

console.log("\n8-K event signals:");

import { emitEightK, EIGHTK_ITEMS } from "../src/lib/ingest/eightk";

check("allowlisted 8-K items become signals; noise items never do", () => {
  const filings = parseSubmissions(load<SubmissionsResponse>("sec-submissions-NVDA.json"));
  const emitted = emitEightK("NVDA", filings);
  assert.ok(emitted > 0, "the NVDA fixture contains allowlisted 8-K items");

  const rows = db
    .prepare("select kind, backfilled, externalId from signals where source='filing' and symbol='NVDA'")
    .all() as Array<{ kind: string; backfilled: number; externalId: string }>;
  assert.equal(rows.length, emitted);
  for (const r of rows) {
    const item = r.kind.replace(/^8k_/, "");
    assert.ok(item in EIGHTK_ITEMS, `${r.kind} must be on the allowlist`);
    assert.ok(!["7.01", "8.01", "9.01"].includes(item), "noise items are excluded");
    assert.match(r.externalId, /^sig:8k:/);
  }
  // Historical filings arrive flagged backfilled — studies fuel, not scorecard fuel.
  assert.ok(rows.every((r) => r.backfilled === 1), "fixture filings are all history");

  const again = emitEightK("NVDA", filings);
  assert.equal(again, 0, "re-scanning the same window emits nothing new");
});

check("one signal per (filing, item) — a multi-item 8-K yields one row per listed item", () => {
  const twoItems = [{
    accession: "acc-multi",
    form: "8-K",
    filedAt: "2026-06-01T12:00:00.000Z",
    periodEnd: null,
    description: null,
    acceptedAt: "2026-06-01T13:00:00.000Z",
    items: ["2.02", "5.02", "9.01"], // 9.01 rides along and must be dropped
  }];
  const emitted = emitEightK("TSTE", twoItems);
  assert.equal(emitted, 2);
});

// ── the drop-in inbox ─────────────────────────────────────────────────────

console.log("\ninbox importer:");

import { parseInboxLine, sweepInbox } from "../src/lib/ingest/inbox";

check("an inbox line with a New York offset normalises to UTC and namespaces its source", () => {
  const s = parseInboxLine(
    JSON.stringify({
      source: "myscanner",
      symbol: "nvda",
      kind: "ORB_Breakout",
      direction: "long",
      firedAt: "2026-08-05T09:35:00-04:00",
    })
  );
  assert.equal(s.source, "import:myscanner");
  assert.equal(s.symbol, "NVDA");
  assert.equal(s.kind, "orb_breakout");
  assert.equal(s.firedAt, "2026-08-05T13:35:00.000Z");
  assert.equal(s.knownAt, s.firedAt, "knownAt defaults to firedAt");
  assert.match(s.externalId!, /^sig:import:myscanner:/);
});

check("malformed inbox lines are refused with a reason, never guessed at", () => {
  assert.throws(() => parseInboxLine(JSON.stringify({ symbol: "A", kind: "k", direction: "long", firedAt: "2026-01-01" })), /source/);
  assert.throws(() => parseInboxLine(JSON.stringify({ source: "s", symbol: "A", kind: "k", direction: "up", firedAt: "2026-01-01" })), /direction/);
  assert.throws(() => parseInboxLine(JSON.stringify({ source: "s", symbol: "A", kind: "k", direction: "long", firedAt: "not a date" })), /timestamp/);
});

check("a dropped file imports, archives, and a re-drop dedupes", () => {
  const root = path.join(process.cwd(), "data", "test-inbox-root");
  const dir = path.join(root, "data", "inbox");
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  const lines = [
    JSON.stringify({ source: "scanner", symbol: "TSTI", kind: "breakout", direction: "long", firedAt: "2026-08-05T09:35:00-04:00" }),
    JSON.stringify({ source: "scanner", symbol: "TSTI", kind: "breakout", direction: "long", firedAt: "2026-08-05T10:10:00-04:00" }),
    "{ this is not json",
  ].join("\n");

  fs.writeFileSync(path.join(dir, "drop.jsonl"), lines);
  const first = sweepInbox(root);
  assert.deepEqual(first, { files: 1, imported: 2, duplicates: 0, malformed: 1 });
  assert.equal(fs.existsSync(path.join(dir, "drop.jsonl")), false, "swept file is archived");
  assert.equal(fs.readdirSync(path.join(dir, "done")).length, 1);

  fs.writeFileSync(path.join(dir, "drop.jsonl"), lines);
  const second = sweepInbox(root);
  assert.equal(second.imported, 0);
  assert.equal(second.duplicates, 2, "content-hash externalIds dedupe a re-drop");

  const n = (db.prepare("select count(*) as n from signals where source='import:scanner'").get() as { n: number }).n;
  assert.equal(n, 2);
  fs.rmSync(root, { recursive: true, force: true });
});

const checkAsync = async (label: string, fn: () => Promise<void>) => {
  try {
    await fn();
    checks++;
    console.log(`  ok  ${label}`);
  } catch (err) {
    failures.push(`${label} — ${(err as Error).message}`);
    console.log(`  FAIL  ${label}\n        ${(err as Error).message}`);
  }
};

// tsx compiles this file as CJS, where top-level await is a syntax error — the
// async tail (and everything after it, including the summary) runs in one IIFE.
(async () => {
await checkAsync("first sight of a company seeds the watermark and fetches nothing", async () => {
  db.prepare(
    "insert into universe (symbol,cik,name,active,addedAt) values ('TSTW','0000000001','Watermark Co',1,?) on conflict do nothing"
  ).run(new Date().toISOString());
  const filings = [
    { accession: "a1", form: "4", filedAt: "2026-01-05T12:00:00.000Z", periodEnd: null, description: null, acceptedAt: "2026-01-05T13:00:00.000Z", items: [] },
  ];
  const r = await syncInsiders("TSTW", "0000000001", filings);
  assert.equal(r.seeded, true);
  assert.equal(r.processed, 0, "history is never fetched on first sight");
  const wm = (db.prepare("select form4Watermark as w from universe where symbol='TSTW'").get() as { w: string | null }).w;
  assert.ok(wm !== null, "watermark now set");
  // Second run with nothing newer than the watermark: still nothing to do.
  const r2 = await syncInsiders("TSTW", "0000000001", filings);
  assert.equal(r2.seeded, false);
  assert.equal(r2.processed, 0);
});

check("submissions now carry acceptance instants and 8-K item codes", () => {
  const subs = load<SubmissionsResponse>("sec-submissions-NVDA.json");
  const filings = parseSubmissions(subs);
  assert.ok(filings.some((f) => f.acceptedAt.includes("T") && !f.acceptedAt.endsWith("T12:00:00.000Z")), "real acceptance instants present");
  const eightK = filings.find((f) => f.form === "8-K");
  assert.ok(eightK && eightK.items.length > 0, "8-K items parsed");
  assert.ok(eightK!.items.every((i) => /^\d+\.\d+$/.test(i)), `item codes look like codes: ${eightK!.items}`);
});

check("reseeding the book keeps market signals and drops book-owned ones", () => {
  const count = (src: string) =>
    (db.prepare("select count(*) as n from signals where source=?").get(src) as { n: number }).n;
  const testBefore = count("test") + count("test2");
  assert.ok(count("monitor") >= 1 && testBefore >= 1, "both kinds present before reset");
  resetDb(db);
  assert.equal(count("monitor"), 0, "monitor signals belong to the book");
  assert.equal(count("journal"), 0, "journal signals belong to the book");
  assert.equal(count("test") + count("test2"), testBefore, "market-collected signals survive");
  const orphans = (
    db.prepare("select count(*) as n from signal_outcomes where signalId not in (select id from signals)").get() as { n: number }
  ).n;
  assert.equal(orphans, 0, "no orphaned outcomes");
});

db.close();
closeDb();
for (const f of [file, `${file}-wal`, `${file}-shm`]) fs.rmSync(f, { force: true });

console.log(`\n${checks} checks passed${failures.length ? `, ${failures.length} failed` : ""}.`);
if (failures.length) {
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
})();
