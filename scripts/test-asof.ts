/**
 * The one check that matters: if the as-of bound leaks, Replay is a lie and the
 * whole product is dishonest. Run with `npm test`.
 */
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { closeDb, ensurePortfolio, openDb } from "../src/lib/db";
import { seedDatabase } from "../src/lib/seed";
import * as q from "../src/lib/queries";
import * as fmt from "../src/lib/format";
import { nextAssumptionIds } from "../src/lib/assumptions";

const file = path.join(process.cwd(), "data", "test-asof.db");
for (const f of [file, `${file}-wal`, `${file}-shm`]) fs.rmSync(f, { force: true });

// queries.ts opens its connection lazily on the first query, so setting this
// before any query call points the whole read layer at the throwaway db.
process.env.ASOF_DB_FILE = file;

const db = openDb(file);
seedDatabase(db);

const dayISO = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString();
let checks = 0;
const check = (label: string, fn: () => void) => {
  fn();
  checks++;
  console.log(`  ok  ${label}`);
};

console.log("as-of bounds");

check("share count reflects only lots up to the bound", () => {
  assert.equal(q.sharesAt("pos_nvda", dayISO(400)), 400, "before the add");
  assert.equal(q.sharesAt("pos_nvda", dayISO(200)), 580, "after the add, before the trim");
  assert.equal(q.sharesAt("pos_nvda"), 460, "all lots");
});

check("thesis returned is the version in force at that date, not the latest", () => {
  assert.equal(q.getThesisAt("pos_nvda", dayISO(400))?.versionNo, 1);
  assert.equal(q.getThesisAt("pos_nvda", dayISO(200))?.versionNo, 2);
  assert.equal(q.getThesisAt("pos_nvda")?.versionNo, 3);
  assert.equal(q.getThesisAt("pos_nvda", dayISO(530)), null, "no thesis before the position existed");
});

check("later thesis versions are invisible from the past", () => {
  const versions = q.listThesisVersions("pos_nvda", dayISO(200));
  assert.deepEqual(
    versions.map((v) => v.versionNo),
    [2, 1]
  );
});

check("price marks respect the bound", () => {
  assert.equal(q.priceAt("pos_nvda", dayISO(400)), 73.9);
  assert.ok((q.priceAt("pos_nvda") ?? 0) > 140);
});

check("positions that did not exist yet are absent", () => {
  const tickers = q.listPositions(dayISO(300)).map((p) => p.ticker);
  assert.ok(tickers.includes("NVDA"));
  assert.ok(!tickers.includes("NKE"), "NKE was opened later");
  assert.ok(!tickers.includes("DLR"), "DLR was opened later");
});

check("a decision's own outcome is hidden at the moment it was taken", () => {
  const ctx = q.getReplayContext("dec_nvda_add")!;
  assert.ok(ctx.decision.outcomeNote, "the reveal side still has the outcome");
  const sealed = q.getDecision("dec_nvda_add", ctx.asOf)!;
  assert.equal(sealed.outcomeNote, null, "the sealed side does not");
  assert.equal(sealed.outcomeVerdict, null);
});

check("an event's outcome is hidden before it resolved", () => {
  const before = q.getEvent("ev_ceg_pjm", dayISO(160))!;
  assert.equal(before.outcome, null);
  assert.equal(before.status, "upcoming");
  const after = q.getEvent("ev_ceg_pjm")!;
  assert.ok(after.outcome?.whatHappened);
  assert.equal(after.status, "resolved");
});

check("events are visible once known, before they occur", () => {
  const ids = q.listEvents({ asOf: dayISO(160) }).map((e) => e.id);
  assert.ok(ids.includes("ev_ceg_pjm"), "known 190 days ago, occurs 150 days ago");
  assert.ok(!ids.includes("ev_fomc"), "not known until 10 days ago");
});

console.log("\nreplay seal");

check("nothing after the decision leaks into the sealed context", () => {
  const ctx = q.getReplayContext("dec_nvda_add")!;
  const at = ctx.decision.occurredAt;
  // Market facts are inclusive of the instant; only later ones are a leak.
  for (const e of ctx.evidenceThen) assert.ok(e.occurredAt <= at, `evidence leaked: ${e.title}`);
  for (const ev of ctx.upcomingThen) assert.ok(ev.knownAt <= at, `event leaked: ${ev.title}`);
  for (const b of ctx.beliefsThen) assert.ok(b.occurredAt <= at, `belief link leaked: ${b.belief.name}`);
  assert.ok(ctx.thesisThen!.occurredAt <= at);
  assert.equal(ctx.thesisThen!.versionNo, 1, "the add was made under thesis v1");
  for (const p of ctx.positionsThen) assert.ok(p.createdAt <= at, `position leaked: ${p.ticker}`);
});

check("a belief link drawn later never appears in an earlier sealed room", () => {
  const link = db
    .prepare("select * from position_beliefs where positionId='pos_nvda' limit 1")
    .get() as { id: string; occurredAt: string };
  const future = new Date(Date.now() + 5 * 86_400_000).toISOString();
  db.prepare("update position_beliefs set occurredAt=? where id=?").run(future, link.id);
  try {
    const ctx = q.getReplayContext("dec_nvda_add")!;
    assert.ok(
      !ctx.beliefsThen.some((b) => b.id === link.id),
      "a link dated after the decision must not be in the room"
    );
    // And the same bound must hold for exposure and reach.
    const past = q.getBeliefExposure(dayISO(300));
    for (const e of past) {
      for (const l of e.links) assert.ok(l.occurredAt <= dayISO(300), "exposure link leaked");
    }
  } finally {
    db.prepare("update position_beliefs set occurredAt=? where id=?").run(link.occurredAt, link.id);
  }
});

check("every replayable decision opens a room with something in it", () => {
  // Four rooms used to render completely blank: thesis, size, price and evidence
  // were all written at the same instant the decision was, and the sealed bound
  // sat 1 ms earlier.
  const empty: string[] = [];
  for (const { decision } of q.listReplayCandidates()) {
    if (!decision.positionId) continue;
    const ctx = q.getReplayContext(decision.id);
    assert.ok(ctx, `no context for ${decision.id}`);
    const substance =
      (ctx!.thesisThen ? 1 : 0) +
      (ctx!.priceThen !== null ? 1 : 0) +
      ctx!.evidenceThen.length +
      ctx!.upcomingThen.length +
      ctx!.positionsThen.length;
    if (substance === 0) empty.push(decision.id);
  }
  assert.deepEqual(empty, [], `sealed rooms with no content: ${empty.join(", ")}`);
});

check("the mark shown is the price on the day, not the previous one", () => {
  for (const id of ["dec_nvda_open", "dec_nvda_add", "dec_ceg_add", "dec_pypl_exit"]) {
    const ctx = q.getReplayContext(id)!;
    const lot = db
      .prepare("select price from lots where positionId=? and occurredAt=? limit 1")
      .get(ctx.decision.positionId, ctx.decision.occurredAt) as { price: number } | undefined;
    if (!lot) continue;
    assert.equal(ctx.priceThen, lot.price, `${id}: mark that day should equal the fill`);
  }
});

check("a thesis_change decision does not show the version it produced", () => {
  const ctx = q.getReplayContext("dec_thesis_nvda_v3")!;
  assert.equal(ctx.thesisThen!.versionNo, 2, "must show v2, not the v3 this decision wrote");
});

check("the portfolio shown is the portfolio of that day", () => {
  const ctx = q.getReplayContext("dec_nvda_add")!;
  const tickers = ctx.positionsThen.map((p) => p.ticker).sort();
  assert.deepEqual(tickers, ["CEG", "FCX", "NVDA", "PYPL"]);
  assert.equal(ctx.position!.shares, 400, "size before the add, not after");
});

check("the reveal side sees what the sealed side could not", () => {
  const ctx = q.getReplayContext("dec_smci_pass")!;
  assert.ok(ctx.marksAfter.length > 0);
  assert.ok(Math.max(...ctx.marksAfter.map((m) => m.price)) > 900, "SMCI ran hard after the pass");
  assert.ok((ctx.priceChangePct ?? 0) < 0, "and ended below where it was passed on");
  for (const t of ctx.timelineAfter) assert.ok(t.at > ctx.decision.occurredAt);
});

console.log("\nderived intelligence");

check("attention engine flags the unreviewed contradiction on NKE", () => {
  const items = q.getAttentionItems();
  const nke = items.find((i) => i.id === "att_contra_pos_nke");
  assert.ok(nke, "expected an unreviewed-contradiction item for NKE");
  assert.equal(nke!.severity, "high");
  assert.ok(nke!.question.length > 0, "every item ends in a question, never a verdict");
});

check("attention engine flags the catalyst that passed unresolved", () => {
  const items = q.getAttentionItems();
  assert.ok(items.some((i) => i.id === "att_stale_ev_ev_fcx_china"));
});

check("correlated-exposure item fires on the shared data-center belief", () => {
  const reach = q.eventReach("ev_nvda_q3");
  assert.ok(reach.length >= 3, `expected 3+ positions reached, got ${reach.length}`);
  assert.ok(q.getAttentionItems().some((i) => i.id === "att_reach_ev_nvda_q3"));
});

check("belief exposure surfaces data-center capex as the concentration", () => {
  const top = q.getBeliefExposure()[0];
  assert.equal(top.belief.id, "bl_aicapex");
  assert.ok(top.heldCount >= 4, "four held positions express it");
  assert.ok(top.weightPct > 50, `expected majority of book, got ${top.weightPct.toFixed(1)}%`);
});

check("patterns are computed from real history and cite it", () => {
  const patterns = q.getPatterns();
  assert.ok(patterns.length >= 3, `expected several patterns, got ${patterns.length}`);
  assert.ok(patterns.some((p) => p.id === "pat_add_weak"));
  for (const p of patterns) {
    assert.ok(p.finding.length > 0 && p.soWhat.length > 0);
    assert.ok(p.evidence.length > 0 || (p.events?.length ?? 0) > 0, `${p.id} cites nothing`);
  }
});

check("calibration buckets only count decisions with recorded outcomes", () => {
  const buckets = q.getCalibration();
  const counted = buckets.reduce((s, b) => s + b.count, 0);
  const resolved = q.listDecisions().filter((d) => d.outcomeVerdict).length;
  assert.equal(counted, resolved);
  assert.ok(buckets.every((b) => b.worked + b.mixed + b.failed === b.count));
});

console.log("\nrealised results");

check("a closed position reports what it actually made or lost", () => {
  const pypl = q.getPositionSnapshot("pos_pypl")!;
  assert.equal(pypl.shares, 0);
  assert.equal(pypl.status, "closed", "status is derived, not the stored string");
  // 700 bought at 61.20, all sold at 55.10.
  assert.ok(Math.abs(pypl.realisedPnl - -4270) < 0.01, `realisedPnl was ${pypl.realisedPnl}`);
  assert.ok(Math.abs(pypl.realisedPct! - -9.9673) < 0.01, `realisedPct was ${pypl.realisedPct}`);
  assert.equal(pypl.exitPrice, 55.1);
  assert.ok(pypl.exitAt, "the exit date is recorded");
  assert.equal(pypl.returnPct, null, "no unrealised return on a position you do not hold");
});

check("a partial sale realises a gain without disturbing the average cost", () => {
  const led = q.positionLedger("pos_nvda");
  assert.equal(led.shares, 460);
  // 400 @ 62 then 180 @ 91.50 -> 71.1552; the trim must not move it.
  assert.ok(Math.abs(led.avgCost - 71.15517) < 0.001, `avgCost was ${led.avgCost}`);
  // 120 sold at 128.
  assert.ok(Math.abs(led.realisedPnl - 120 * (128 - 71.15517)) < 0.1);
  assert.equal(led.exitPrice, null, "still held, so there is no exit");
});

check("as-of status un-closes a position when you rewind past the sale", () => {
  const before = q.getPositionSnapshot("pos_pypl", dayISO(300))!;
  assert.equal(before.status, "open");
  assert.equal(before.declaredStatus, "closed", "the stored value is still available");
  assert.ok(before.shares > 0);
});

check("a position that was never bought reads as watching, not closed", () => {
  const id = "pos_watch_test";
  db.prepare(
    `insert into positions (id,portfolioId,ticker,name,assetClass,status,openedAt,closedAt,createdAt)
     values (?, (select id from portfolios limit 1), 'WCH','Watch Test',null,'watching',null,null,?)`
  ).run(id, dayISO(30));
  try {
    const p = q.getPositionSnapshot(id)!;
    assert.equal(p.status, "watching");
    assert.equal(p.realisedPnl, 0);
    assert.equal(p.price, null, "no marks means no price, not zero");
    assert.equal(p.value, 0);
  } finally {
    db.prepare("delete from positions where id=?").run(id);
  }
});

console.log("\nintegrity");

check("assumption ids are never re-minted after a drop", () => {
  // a1-a4, drop a2, add one -> a5. Then add another: it must not be a5 again.
  const first = [
    { id: "a1", text: "one", status: "intact" as const },
    { id: "a3", text: "three", status: "intact" as const },
    { id: "a4", text: "four", status: "intact" as const },
  ];
  assert.deepEqual(nextAssumptionIds(first, 1), ["a5"]);
  const second = [...first, { id: "a5", text: "five", status: "intact" as const }];
  assert.deepEqual(nextAssumptionIds(second, 1), ["a6"], "must not collide with the surviving a5");
  assert.deepEqual(nextAssumptionIds(second, 3), ["a6", "a7", "a8"]);
  assert.deepEqual(nextAssumptionIds([], 2), ["a1", "a2"]);
});

check("a duplicate belief link cannot be inserted", () => {
  const l = db.prepare("select * from position_beliefs limit 1").get() as {
    positionId: string;
    beliefId: string;
  };
  assert.throws(
    () =>
      db
        .prepare(
          `insert into position_beliefs (id,positionId,beliefId,relationship,sensitivity,occurredAt,createdAt)
           values ('dupe',?,?,null,'high','2020-01-01T00:00:00.000Z','2020-01-01T00:00:00.000Z')`
        )
        .run(l.positionId, l.beliefId),
    /UNIQUE/i,
    "the unique index is what stops belief exposure exceeding 100%"
  );
});

check("belief exposure never exceeds 100% of the book", () => {
  for (const e of q.getBeliefExposure()) {
    assert.ok(e.weightPct <= 100.0001, `${e.belief.name} at ${e.weightPct}%`);
    assert.ok(e.highSensitivityWeightPct <= e.weightPct + 0.0001);
  }
});

check("a resolved event with no resolvedAt still hides its outcome in the past", () => {
  db.prepare("update events set resolvedAt=null where id='ev_ceg_pjm'").run();
  try {
    const past = q.getEvent("ev_ceg_pjm", dayISO(300))!;
    assert.equal(past.outcome, null, "a null resolvedAt must not become 'always visible'");
    assert.equal(past.status, "upcoming");
  } finally {
    db.prepare("update events set resolvedAt=? where id='ev_ceg_pjm'").run(dayISO(149));
  }
});

check("listDecisions and listEvents survive a falsy positionId", () => {
  for (const bad of ["", null, undefined]) {
    assert.doesNotThrow(
      () => q.listDecisions({ positionId: bad as unknown as string }),
      `listDecisions threw on positionId=${String(bad)}`
    );
    assert.doesNotThrow(
      () => q.listEvents({ positionId: bad as unknown as string }),
      `listEvents threw on positionId=${String(bad)}`
    );
  }
  assert.equal(q.listDecisions({ positionId: "" }).length, q.listDecisions({}).length);
});

check("patterns assert nothing they have not computed", () => {
  const banned = [
    "In at least one case the written trim condition",
    "Your adds into intact theses have a different record",
  ];
  for (const p of q.getPatterns()) {
    for (const phrase of banned) {
      assert.ok(!p.finding.includes(phrase), `${p.id} still asserts an uncomputed claim`);
      assert.ok(!p.soWhat.includes(phrase), `${p.id} still asserts an uncomputed claim`);
    }
  }
});

check("the unresolved-decisions rule respects the as-of bound", () => {
  // dec_nke_hold is 20 days old today, so it is not a >60-day-old open loop now.
  const now = q.getPatterns().find((p) => p.id === "pat_unresolved");
  const nowIds = new Set(now?.evidence.map((d) => d.id) ?? []);
  assert.ok(!nowIds.has("dec_nke_hold"));
  // Viewed from a date before it was taken, it must not be counted at all.
  const past = q.getPatterns(dayISO(200)).find((p) => p.id === "pat_unresolved");
  for (const d of past?.evidence ?? []) {
    assert.ok(d.occurredAt <= dayISO(200), `leaked a decision from the future: ${d.id}`);
  }
});

check("an empty database renders rather than throwing", () => {
  const blank = path.join(process.cwd(), "data", "test-empty.db");
  for (const f of [blank, `${blank}-wal`, `${blank}-shm`]) fs.rmSync(f, { force: true });
  const fresh = openDb(blank);
  try {
    ensurePortfolio(fresh);
    const pf = fresh.prepare("select * from portfolios").all();
    assert.equal(pf.length, 1, "a portfolio row is guaranteed, so getPortfolio cannot be undefined");
  } finally {
    fresh.close();
    for (const f of [blank, `${blank}-wal`, `${blank}-shm`]) fs.rmSync(f, { force: true });
  }
});

console.log("\nformatting");

check("a value that rounds to zero is not given a sign", () => {
  assert.equal(fmt.pct(-0.04), "0.0%");
  assert.equal(fmt.signedPct(-0.04), "0.0%");
  assert.equal(fmt.signedPct(0), "0.0%");
  assert.equal(fmt.pct(-1), "−1.0%");
  assert.equal(fmt.signedPct(1.25), "+1.3%");
  assert.equal(fmt.pct(null), "—");
  assert.equal(fmt.pct(Infinity), "—", "an infinite ratio is not a percentage");
  assert.equal(fmt.money(-100), "−$100", "same minus glyph as the percentages");
});

check("spans read naturally at every scale and never say '1 days'", () => {
  const d = (n: number) => n * 86_400_000;
  assert.equal(fmt.describeSpan(d(1)), "1 day");
  assert.equal(fmt.describeSpan(d(16)), "16 days");
  assert.equal(fmt.describeSpan(d(31)), "31 days");
  assert.equal(fmt.describeSpan(d(35)), "1 month", "1 month must be reachable");
  assert.equal(fmt.describeSpan(d(46)), "2 months");
  // Months stay readable up to 18; beyond that years are easier to hold.
  assert.equal(fmt.describeSpan(d(365.25)), "12 months");
  assert.equal(fmt.describeSpan(d(520)), "17 months");
  assert.equal(fmt.describeSpan(d(700)), "1.9 years");
  assert.equal(fmt.describeSpan(d(365.25 * 2)), "2 years");
  assert.equal(fmt.relativeDays(new Date(Date.now() - d(1)).toISOString()), "yesterday");
});

db.close();
closeDb();
for (const f of [file, `${file}-wal`, `${file}-shm`]) fs.rmSync(f, { force: true });
console.log(`\n${checks} checks passed.`);
