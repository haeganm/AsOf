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
import { closeDb, openDb } from "../src/lib/db";

const FIX = path.join(process.cwd(), "scripts", "fixtures");
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
  storeFilings("pos_t", "pf", "NVDA", filings);
  storeFilings("pos_t", "pf", "NVDA", filings);
  const evs = db
    .prepare("select id, estimated, externalId, title from events where positionId='pos_t'")
    .all() as Array<{ estimated: number; externalId: string; title: string }>;
  assert.equal(evs.length, 1, "the estimate is one upserted row, not one per run");
  assert.equal(evs[0].estimated, 1);
  assert.match(evs[0].title, /estimated/i, "the UI must be able to say this is derived");
});

check("filing descriptions read as English", () => {
  const at = { accession: "a", filedAt: "2026-01-01T00:00:00.000Z", periodEnd: "2025-12-31", description: null };
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
  const { value, describe } = read(m);
  assert.ok(value !== null && value! <= 0, "a drawdown is zero or negative");
  assert.match(describe, /high of/);

  const transitions = evaluateMonitors();
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

db.close();
closeDb();
for (const f of [file, `${file}-wal`, `${file}-shm`]) fs.rmSync(f, { force: true });

console.log(`\n${checks} checks passed${failures.length ? `, ${failures.length} failed` : ""}.`);
if (failures.length) {
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
