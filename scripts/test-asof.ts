/**
 * The one check that matters: if the as-of bound leaks, Replay is a lie and the
 * whole product is dishonest. Run with `npm test`.
 */
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { closeDb, openDb } from "../src/lib/db";
import { seedDatabase } from "../src/lib/seed";
import * as q from "../src/lib/queries";

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
  for (const e of ctx.evidenceThen) assert.ok(e.occurredAt < at, `evidence leaked: ${e.title}`);
  for (const ev of ctx.upcomingThen) assert.ok(ev.knownAt < at, `event leaked: ${ev.title}`);
  assert.ok(ctx.thesisThen!.occurredAt < at);
  assert.equal(ctx.thesisThen!.versionNo, 1, "the add was made under thesis v1");
  for (const p of ctx.positionsThen) assert.ok(p.createdAt < at, `position leaked: ${p.ticker}`);
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

db.close();
closeDb();
for (const f of [file, `${file}-wal`, `${file}-shm`]) fs.rmSync(f, { force: true });
console.log(`\n${checks} checks passed.`);
