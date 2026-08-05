import { getDb } from "./db";
import { describeSpan } from "./format";
import type {
  AttentionItem,
  Belief,
  BeliefExposure,
  CalibrationBucket,
  CatalystEvent,
  Decision,
  Evidence,
  Lot,
  Mark,
  Pattern,
  Portfolio,
  Position,
  PositionBelief,
  PositionSnapshot,
  Postmortem,
  ReplayAttempt,
  ReplayContext,
  Thesis,
  TimelineEntry,
} from "./view-types";

/**
 * Every read goes through here, and every read takes an optional `asOf`.
 * That single convention is what makes Replay possible: rendering the app at a
 * past moment is the same code path as rendering it now, with a different bound.
 */

const OPEN_END = "9999-12-31T23:59:59.999Z";
const bound = (asOf?: string | null) => asOf ?? OPEN_END;

/** One millisecond before `iso` — used to seal a decision out of its own context. */
export function justBefore(iso: string) {
  return new Date(new Date(iso).getTime() - 1).toISOString();
}

// ── row parsing ───────────────────────────────────────────────────────────
const parse = <T,>(s: unknown, fallback: T): T => {
  if (typeof s !== "string" || s.length === 0) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
};

function toThesis(r: Record<string, unknown>): Thesis {
  return {
    ...(r as unknown as Thesis),
    assumptions: parse(r.assumptions, []),
    catalysts: parse(r.catalysts, []),
    risks: parse(r.risks, []),
    falsifiers: parse(r.falsifiers, []),
  };
}

function toEvent(r: Record<string, unknown>, asOf?: string): CatalystEvent {
  const ev = {
    ...(r as unknown as CatalystEvent),
    keyVariables: parse(r.keyVariables, []),
    scenarios: parse(r.scenarios, []),
    outcome: parse(r.outcome, null),
  };
  // The outcome did not exist yet at `asOf`, so it must not be visible.
  // Keyed on "is there an outcome" rather than on resolvedAt alone: a resolved
  // row with a null resolvedAt would otherwise leak at every bound.
  if (asOf && (ev.outcome || ev.status === "resolved")) {
    const knownResolved = ev.resolvedAt !== null && ev.resolvedAt <= asOf;
    if (!knownResolved) {
      ev.outcome = null;
      ev.resolvedAt = null;
      ev.status = "upcoming";
    }
  }
  return ev;
}

function toDecision(r: Record<string, unknown>, asOf?: string): Decision {
  const dec = { ...(r as unknown as Decision) };
  // Same reasoning as toEvent: a verdict with no outcomeAt must still be hidden.
  if (asOf && (dec.outcomeVerdict || dec.outcomeNote)) {
    const knownJudged = dec.outcomeAt !== null && dec.outcomeAt <= asOf;
    if (!knownJudged) {
      dec.outcomeAt = null;
      dec.outcomeNote = null;
      dec.outcomeVerdict = null;
    }
  }
  return dec;
}

function toPostmortem(r: Record<string, unknown>): Postmortem {
  return { ...(r as unknown as Postmortem), verdicts: parse(r.verdicts, {} as never) };
}

// ── portfolio & positions ─────────────────────────────────────────────────

export function getPortfolio(): Portfolio {
  return getDb().prepare("select * from portfolios limit 1").get() as Portfolio;
}

export function sharesAt(positionId: string, asOf?: string): number {
  const r = getDb()
    .prepare("select coalesce(sum(deltaShares),0) as s from lots where positionId=? and occurredAt<=?")
    .get(positionId, bound(asOf)) as { s: number };
  return r.s;
}

/** Anything smaller than this is float residue from fractional lots, not a holding. */
const EPS = 0.0001;

export interface Ledger {
  shares: number;
  /** Average cost of the *current* holding. 0 when flat. */
  avgCost: number;
  /** Cost basis of the shares that have been sold. */
  soldCost: number;
  realisedPnl: number;
  exitPrice: number | null;
  exitAt: string | null;
}

/**
 * One walk over the lots produces every derived number, so nothing is computed
 * twice and realised P&L is not lost the moment a position goes flat.
 */
export function positionLedger(positionId: string, asOf?: string): Ledger {
  const rows = getDb()
    .prepare(
      // rowid breaks ties so same-instant lots replay in insertion order — a sell
      // must never be processed before the buy it reduces.
      "select deltaShares, price, occurredAt from lots where positionId=? and occurredAt<=? order by occurredAt, rowid"
    )
    .all(positionId, bound(asOf)) as Array<{ deltaShares: number; price: number; occurredAt: string }>;

  let shares = 0;
  let cost = 0;
  let soldCost = 0;
  let realisedPnl = 0;
  let exitPrice: number | null = null;
  let exitAt: string | null = null;

  for (const l of rows) {
    if (l.deltaShares > 0) {
      cost += l.deltaShares * l.price;
      shares += l.deltaShares;
    } else {
      const qty = Math.min(-l.deltaShares, shares);
      const avg = shares > EPS ? cost / shares : 0;
      realisedPnl += qty * (l.price - avg);
      soldCost += qty * avg;
      cost -= qty * avg;
      shares += l.deltaShares;
      exitPrice = l.price;
      exitAt = l.occurredAt;
    }
  }

  const flat = shares <= EPS;
  return {
    shares,
    avgCost: flat ? 0 : cost / shares,
    soldCost,
    realisedPnl,
    exitPrice: flat ? exitPrice : null,
    exitAt: flat ? exitAt : null,
  };
}

/** Average cost of the current holding. 0 when flat — use `positionLedger` for a closed position. */
export function costBasisAt(positionId: string, asOf?: string): number {
  return positionLedger(positionId, asOf).avgCost;
}

export function priceAt(positionId: string, asOf?: string): number | null {
  const r = getDb()
    .prepare(
      "select price from marks where positionId=? and occurredAt<=? order by occurredAt desc limit 1"
    )
    .get(positionId, bound(asOf)) as { price: number } | undefined;
  return r?.price ?? null;
}

/** Percentage price move between a past date and now. Used for exits and passes. */
export function priceMoveSince(positionId: string, fromIso: string | null): number | null {
  if (!fromIso) return null;
  const then = priceAt(positionId, fromIso);
  const now = priceAt(positionId);
  return then && now ? (now / then - 1) * 100 : null;
}

export function marksFor(positionId: string, opts: { asOf?: string; after?: string } = {}): Mark[] {
  return getDb()
    .prepare(
      "select * from marks where positionId=? and occurredAt<=? and occurredAt>? order by occurredAt"
    )
    .all(positionId, bound(opts.asOf), opts.after ?? "") as Mark[];
}

export function getThesisAt(positionId: string, asOf?: string): Thesis | null {
  const r = getDb()
    .prepare(
      "select * from thesis_versions where positionId=? and occurredAt<=? order by occurredAt desc, versionNo desc limit 1"
    )
    .get(positionId, bound(asOf)) as Record<string, unknown> | undefined;
  return r ? toThesis(r) : null;
}

export function listThesisVersions(positionId: string, asOf?: string): Thesis[] {
  const rows = getDb()
    .prepare(
      "select * from thesis_versions where positionId=? and occurredAt<=? order by versionNo desc"
    )
    .all(positionId, bound(asOf)) as Record<string, unknown>[];
  return rows.map(toThesis);
}

/** Last time the investor did anything with this position — trades and events included. */
export function lastActivityAt(positionId: string, asOf?: string): string | null {
  const b = bound(asOf);
  const r = getDb()
    .prepare(
      `select max(at) as at from (
         select max(occurredAt) as at from thesis_versions where positionId=? and occurredAt<=?
         union all select max(occurredAt) from decisions where positionId=? and occurredAt<=?
         union all select max(occurredAt) from evidence where positionId=? and occurredAt<=?
         union all select max(occurredAt) from lots where positionId=? and occurredAt<=?
         union all select max(occurredAt) from postmortems where positionId=? and occurredAt<=?
         union all select max(knownAt) from events where positionId=? and knownAt<=?
       )`
    )
    .get(positionId, b, positionId, b, positionId, b, positionId, b, positionId, b, positionId, b) as {
    at: string | null;
  };
  return r.at;
}

/**
 * `status` is deliberately overwritten with the status *as of the bound* rather
 * than the stored one, so rewinding un-closes a position everywhere at once and
 * a "watching" idea stops reporting itself as closed.
 */
function snapshot(p: Position, asOf: string | undefined, totalValue: number): PositionSnapshot {
  const led = positionLedger(p.id, asOf);
  const price = priceAt(p.id, asOf);
  const value = price !== null ? led.shares * price : 0;
  const held = led.shares > EPS;
  const b = bound(asOf);

  const status: Position["status"] =
    p.status === "passed"
      ? "passed"
      : held
        ? "open"
        : p.closedAt && p.closedAt <= b
          ? "closed"
          : "watching";

  const unrealisedPnl = held && price !== null ? led.shares * (price - led.avgCost) : 0;

  return {
    ...p,
    status,
    declaredStatus: p.status,
    shares: led.shares,
    price,
    value,
    costBasis: led.avgCost,
    returnPct: led.avgCost > 0 && price !== null ? (price / led.avgCost - 1) * 100 : null,
    realisedPnl: led.realisedPnl,
    realisedPct: led.soldCost > 0 ? (led.realisedPnl / led.soldCost) * 100 : null,
    unrealisedPnl,
    totalPnl: led.realisedPnl + unrealisedPnl,
    exitPrice: led.exitPrice,
    exitAt: led.exitAt,
    weightPct: totalValue > 0 ? (value / totalValue) * 100 : 0,
    thesis: getThesisAt(p.id, asOf),
    lastActivityAt: lastActivityAt(p.id, asOf),
  };
}

export function listPositions(asOf?: string): PositionSnapshot[] {
  const rows = getDb()
    .prepare("select * from positions where createdAt<=? order by ticker")
    .all(bound(asOf)) as Position[];

  // Snapshot once with a zero total, then fill weights in — the previous version
  // recomputed shares three times and the price twice for every held position.
  const first = rows.map((p) => snapshot(p, asOf, 0));
  const total = first.reduce((s, x) => s + x.value, 0);
  for (const p of first) p.weightPct = total > 0 ? (p.value / total) * 100 : 0;

  return first.sort((a, b) => b.value - a.value || a.ticker.localeCompare(b.ticker));
}

export function getPositionSnapshot(id: string, asOf?: string): PositionSnapshot | null {
  // No createdAt bound here on purpose. Replaying the decision to *open* a
  // position has to be able to name the instrument, even though at that instant
  // the size and holdings are still empty — and those are bounded.
  const p = getDb().prepare("select * from positions where id=?").get(id) as Position | undefined;
  if (!p) return null;
  const total = listPositions(asOf).reduce((s, x) => s + x.value, 0);
  return snapshot(p, asOf, total);
}

// ── evidence, decisions, events ───────────────────────────────────────────

export function listEvidence(positionId: string, opts: { asOf?: string; after?: string } = {}): Evidence[] {
  return getDb()
    .prepare(
      "select * from evidence where positionId=? and occurredAt<=? and occurredAt>? order by occurredAt desc"
    )
    .all(positionId, bound(opts.asOf), opts.after ?? "") as Evidence[];
}

export function listDecisions(
  opts: { asOf?: string; positionId?: string | null; after?: string } = {}
): Decision[] {
  // One definition of "provided", used for both the clause and the parameters.
  // Previously the clause tested truthiness while the parameter list filtered on
  // `!== undefined`, so a defined-but-empty positionId bound a value with no
  // placeholder to receive it and SQLite threw.
  const params: string[] = [bound(opts.asOf), opts.after ?? ""];
  let clause = "";
  if (opts.positionId) {
    clause = "and positionId=?";
    params.push(opts.positionId);
  }
  const rows = getDb()
    .prepare(
      `select * from decisions where occurredAt<=? and occurredAt>? ${clause} order by occurredAt desc`
    )
    .all(...params) as Record<string, unknown>[];
  return rows.map((r) => toDecision(r, opts.asOf));
}

export function getDecision(id: string, asOf?: string): Decision | null {
  const r = getDb().prepare("select * from decisions where id=?").get(id) as
    | Record<string, unknown>
    | undefined;
  return r ? toDecision(r, asOf) : null;
}

/**
 * Events known at `asOf`. Note this filters on `knownAt`, not `occurredAt` —
 * an event you have prepared for is part of your world before it happens.
 */
export function listEvents(
  opts: { asOf?: string; positionId?: string | null; status?: "upcoming" | "resolved" } = {}
): CatalystEvent[] {
  const params: string[] = [bound(opts.asOf)];
  let clause = "";
  if (opts.positionId) {
    clause = "and positionId=?";
    params.push(opts.positionId);
  }
  const rows = getDb()
    .prepare(`select * from events where knownAt<=? ${clause} order by occurredAt`)
    .all(...params) as Record<string, unknown>[];
  const evs = rows.map((r) => toEvent(r, opts.asOf));
  return opts.status ? evs.filter((e) => e.status === opts.status) : evs;
}

export function getEvent(id: string, asOf?: string): CatalystEvent | null {
  const r = getDb().prepare("select * from events where id=?").get(id) as
    | Record<string, unknown>
    | undefined;
  return r ? toEvent(r, asOf) : null;
}

export function listPostmortems(asOf?: string): Postmortem[] {
  const rows = getDb()
    .prepare("select * from postmortems where occurredAt<=? order by occurredAt desc")
    .all(bound(asOf)) as Record<string, unknown>[];
  return rows.map(toPostmortem);
}

export function getPostmortem(id: string): Postmortem | null {
  const r = getDb().prepare("select * from postmortems where id=?").get(id) as
    | Record<string, unknown>
    | undefined;
  return r ? toPostmortem(r) : null;
}

export function getPostmortemForPosition(positionId: string): Postmortem | null {
  const r = getDb()
    .prepare("select * from postmortems where positionId=? order by occurredAt desc limit 1")
    .get(positionId) as Record<string, unknown> | undefined;
  return r ? toPostmortem(r) : null;
}

// ── timeline ──────────────────────────────────────────────────────────────

export function getTimeline(
  positionId: string,
  opts: { asOf?: string; after?: string } = {}
): TimelineEntry[] {
  const db = getDb();
  const b = bound(opts.asOf);
  const after = opts.after ?? "";
  const out: TimelineEntry[] = [];

  for (const e of listEvidence(positionId, opts)) out.push({ at: e.occurredAt, kind: "evidence", data: e });
  for (const d of listDecisions({ ...opts, positionId })) out.push({ at: d.occurredAt, kind: "decision", data: d });

  const theses = db
    .prepare("select * from thesis_versions where positionId=? and occurredAt<=? and occurredAt>?")
    .all(positionId, b, after) as Record<string, unknown>[];
  for (const t of theses) out.push({ at: t.occurredAt as string, kind: "thesis", data: toThesis(t) });

  const lots = db
    .prepare("select * from lots where positionId=? and occurredAt<=? and occurredAt>?")
    .all(positionId, b, after) as Lot[];
  for (const l of lots) out.push({ at: l.occurredAt, kind: "lot", data: l });

  for (const ev of listEvents({ asOf: opts.asOf, positionId })) {
    if (ev.knownAt > after) out.push({ at: ev.knownAt, kind: "event", data: ev, phase: "prepared" });
    if (ev.resolvedAt && ev.resolvedAt > after)
      out.push({ at: ev.resolvedAt, kind: "event", data: ev, phase: "resolved" });
  }

  const pms = db
    .prepare("select * from postmortems where positionId=? and occurredAt<=? and occurredAt>?")
    .all(positionId, b, after) as Record<string, unknown>[];
  for (const p of pms) out.push({ at: p.occurredAt as string, kind: "postmortem", data: toPostmortem(p) });

  return out.sort((a, z) => z.at.localeCompare(a.at));
}

// ── beliefs ───────────────────────────────────────────────────────────────

export function listBeliefs(asOf?: string): Belief[] {
  return getDb()
    .prepare("select * from beliefs where createdAt<=? order by name")
    .all(bound(asOf)) as Belief[];
}

export function getBelief(id: string): Belief | null {
  return (getDb().prepare("select * from beliefs where id=?").get(id) as Belief) ?? null;
}

/**
 * Bounded on the link's own `occurredAt`. Without this, a belief you connected
 * to a position today shows up inside a Replay room sealed to a past date —
 * along with the sentence you wrote today explaining the connection.
 */
export function beliefsForPosition(
  positionId: string,
  asOf?: string
): Array<PositionBelief & { belief: Belief }> {
  return getDb()
    .prepare(
      `select pb.*, b.name as b_name, b.description as b_description, b.stance as b_stance,
              b.confidence as b_confidence, b.createdAt as b_createdAt
       from position_beliefs pb join beliefs b on b.id=pb.beliefId
       where pb.positionId=? and pb.occurredAt<=? and b.createdAt<=?
       order by case pb.sensitivity when 'high' then 0 when 'medium' then 1 else 2 end`
    )
    .all(positionId, bound(asOf), bound(asOf))
    .map((r) => {
      const row = r as Record<string, unknown>;
      return {
        id: row.id as string,
        positionId: row.positionId as string,
        beliefId: row.beliefId as string,
        relationship: row.relationship as string | null,
        sensitivity: row.sensitivity as PositionBelief["sensitivity"],
        occurredAt: row.occurredAt as string,
        belief: {
          id: row.beliefId as string,
          name: row.b_name as string,
          description: row.b_description as string | null,
          stance: row.b_stance as string | null,
          confidence: row.b_confidence as number | null,
          createdAt: row.b_createdAt as string,
        },
      };
    });
}

/** Beliefs with the positions expressing them and the share of book at risk. */
export function getBeliefExposure(asOf?: string): BeliefExposure[] {
  const positions = listPositions(asOf);
  const byId = new Map(positions.map((p) => [p.id, p]));
  const total = positions.reduce((s, p) => s + p.value, 0);
  // Link membership is bounded too, not just the values it is multiplied by.
  const links = getDb()
    .prepare("select * from position_beliefs where occurredAt<=?")
    .all(bound(asOf)) as PositionBelief[];
  // Hoisted out of the map: this used to run one listEvents plus one
  // eventBeliefIds per event per belief — 42 queries on the demo book.
  const events = listEvents({ asOf });
  const eventBeliefs = new Map(events.map((e) => [e.id, eventBeliefIds(e.id, asOf)]));

  return listBeliefs(asOf)
    .map((belief) => {
      const mine = links.filter((l) => l.beliefId === belief.id && byId.has(l.positionId));
      const held = mine.filter((l) => (byId.get(l.positionId)?.value ?? 0) > 0);
      const value = held.reduce((s, l) => s + (byId.get(l.positionId)?.value ?? 0), 0);
      const highValue = held
        .filter((l) => l.sensitivity === "high")
        .reduce((s, l) => s + (byId.get(l.positionId)?.value ?? 0), 0);
      return {
        belief,
        links: mine.map((l) => ({ ...l, position: byId.get(l.positionId)! })),
        heldCount: held.length,
        value,
        weightPct: total > 0 ? (value / total) * 100 : 0,
        highSensitivityWeightPct: total > 0 ? (highValue / total) * 100 : 0,
        events: events.filter((e) => (eventBeliefs.get(e.id) ?? []).includes(belief.id)),
      };
    })
    .sort((a, b) => b.weightPct - a.weightPct || b.heldCount - a.heldCount);
}

export function eventBeliefIds(eventId: string, asOf?: string): string[] {
  return (
    getDb()
      .prepare("select beliefId from event_beliefs where eventId=? and occurredAt<=?")
      .all(eventId, bound(asOf)) as Array<{ beliefId: string }>
  ).map((r) => r.beliefId);
}

/** Positions an event reaches indirectly, through the beliefs it touches. */
export function eventReach(eventId: string, asOf?: string) {
  const beliefIds = eventBeliefIds(eventId, asOf);
  if (beliefIds.length === 0) return [];
  const links = getDb()
    .prepare("select * from position_beliefs where occurredAt<=?")
    .all(bound(asOf)) as PositionBelief[];
  const held = new Map(listPositions(asOf).filter((p) => p.value > 0).map((p) => [p.id, p]));
  const seen = new Map<string, { position: PositionSnapshot; via: string[] }>();
  for (const l of links) {
    if (!beliefIds.includes(l.beliefId)) continue;
    const p = held.get(l.positionId);
    if (!p) continue;
    const entry = seen.get(p.id) ?? { position: p, via: [] };
    entry.via.push(l.beliefId);
    seen.set(p.id, entry);
  }
  return [...seen.values()].sort((a, b) => b.position.value - a.position.value);
}

// ── attention engine ──────────────────────────────────────────────────────

const DAY = 86_400_000;
const STALE_DAYS = 75;
/** Below this, a "pattern" is an anecdote. Every card is gated on it. */
const MIN_N = 3;

/**
 * Surfaces tension. Deliberately never claims a thesis is right or wrong —
 * every item ends in a question for the user, not a verdict.
 */
export function getAttentionItems(asOf?: string): AttentionItem[] {
  const items: AttentionItem[] = [];
  const nowIso = asOf ?? new Date().toISOString();
  const nowMs = new Date(nowIso).getTime();
  const positions = listPositions(asOf);

  for (const p of positions) {
    const thesis = p.thesis;
    if (!thesis || p.status === "passed") continue;
    const isHeld = p.shares > 0.0001;

    // 1. Evidence standing against an assumption, with no thesis revision since.
    const contradictions = listEvidence(p.id, { asOf }).filter(
      (e) => e.contradictsAssumptionId && e.occurredAt > thesis.occurredAt
    );
    if (isHeld && contradictions.length > 0) {
      const names = contradictions
        .map((c) => thesis.assumptions.find((a) => a.id === c.contradictsAssumptionId)?.text)
        .filter(Boolean) as string[];
      items.push({
        id: `att_contra_${p.id}`,
        severity: "high",
        kind: "Unreviewed contradiction",
        positionId: p.id,
        headline:
          contradictions.length === 1
            ? `${p.ticker}: a piece of evidence stands against your assumptions, recorded after your last thesis update`
            : `${p.ticker}: ${contradictions.length} pieces of evidence stand against your assumptions, recorded after your last thesis update`,
        detail: names.length
          ? `Affected: ${[...new Set(names)].map((n) => `“${n}”`).join("; ")}. Thesis v${thesis.versionNo} was written ${span(thesis.occurredAt, nowIso)} ago and has not been revisited since this evidence arrived.`
          : `Thesis v${thesis.versionNo} predates this evidence.`,
        href: `/positions/${p.id}`,
        question: "Does the thesis still say what you believe, or is it just the last version you wrote?",
      });
    }

    // 2. Structural weakening: most of the thesis is no longer intact.
    const weak = thesis.assumptions.filter((a) => a.status !== "intact");
    if (isHeld && thesis.assumptions.length > 0 && weak.length >= Math.ceil(thesis.assumptions.length / 2)) {
      items.push({
        id: `att_weak_${p.id}`,
        severity: weak.some((a) => a.status === "broken") ? "high" : "medium",
        kind: "Load-bearing assumptions weakening",
        positionId: p.id,
        headline: `${p.ticker}: ${weak.length} of ${thesis.assumptions.length} assumptions are no longer intact`,
        detail: weak.map((a) => `${a.status === "broken" ? "Broken" : "Weakening"} — ${a.text}`).join(" · "),
        href: `/positions/${p.id}`,
        question: `You are holding ${fmtPct(p.weightPct)} of the book on this. Would you open it today at this size?`,
      });
    }

    // 3. Held position with nothing recorded in a long time.
    const last = p.lastActivityAt;
    if (isHeld && last && nowMs - new Date(last).getTime() > STALE_DAYS * DAY) {
      items.push({
        id: `att_stale_${p.id}`,
        severity: "low",
        kind: "Not reviewed",
        positionId: p.id,
        headline: `${p.ticker}: nothing recorded for ${span(last, nowIso)}`,
        detail: `Last entry of any kind was ${fmtDate(last)}. The book has moved since.`,
        href: `/positions/${p.id}`,
        question: "Is nothing happening, or are you not looking?",
      });
    }
  }

  // 4. Catalysts that have passed without an outcome recorded.
  for (const ev of listEvents({ asOf, status: "upcoming" })) {
    if (ev.occurredAt <= nowIso) {
      items.push({
        id: `att_stale_ev_${ev.id}`,
        severity: "high",
        kind: "Catalyst passed",
        positionId: ev.positionId ?? undefined,
        headline: `“${ev.title}” happened ${span(ev.occurredAt, nowIso)} ago and has no outcome recorded`,
        detail:
          "You wrote down what you expected before it. Comparing that to what actually happened is the only part that teaches you anything — and it decays fast.",
        href: `/events/${ev.id}`,
        question: "What actually happened, and were you right for the reason you thought?",
      });
    }
  }

  // 5. One event, several positions — concentration you can only see through beliefs.
  for (const ev of listEvents({ asOf, status: "upcoming" })) {
    const reach = eventReach(ev.id, asOf);
    if (reach.length >= 3) {
      const exposure = reach.reduce((s, r) => s + r.position.weightPct, 0);
      items.push({
        id: `att_reach_${ev.id}`,
        severity: "medium",
        kind: "Correlated exposure",
        headline: `“${ev.title}” reaches ${reach.length} positions — ${fmtPct(exposure)} of the book`,
        detail: `Not just ${reach[0].position.ticker}: ${reach.map((r) => r.position.ticker).join(", ")} all depend on beliefs this event tests.`,
        href: `/events/${ev.id}`,
        question: "Is this one position's event, or the book's?",
      });
    }
  }

  // 6. Acted at low conviction and never came back to it.
  for (const dec of listDecisions({ asOf })) {
    if (dec.confidence <= 2 && !dec.outcomeVerdict) {
      const p = positions.find((x) => x.id === dec.positionId);
      items.push({
        id: `att_lowconf_${dec.id}`,
        severity: "medium",
        kind: "Low-conviction decision open",
        positionId: dec.positionId ?? undefined,
        headline: `${p ? p.ticker + ": " : ""}you acted at ${dec.confidence}/5 confidence and have not resolved it`,
        detail: `${fmtDate(dec.occurredAt)} — ${dec.what} You wrote at the time: “${dec.mainRisk ?? dec.why}”`,
        href: `/decisions/${dec.id}`,
        question: "A decision you did not believe in is still a decision. Is it still the right one?",
      });
    }
  }

  const rank = { high: 0, medium: 1, low: 2 };
  return items.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

// ── patterns & calibration ────────────────────────────────────────────────

export function getCalibration(asOf?: string): CalibrationBucket[] {
  const resolved = listDecisions({ asOf }).filter((d) => d.outcomeVerdict);
  const buckets: CalibrationBucket[] = [];
  for (let c = 1; c <= 5; c++) {
    const inBucket = resolved.filter((d) => d.confidence === c);
    if (inBucket.length === 0) continue;
    const worked = inBucket.filter((d) => d.outcomeVerdict === "worked").length;
    const mixed = inBucket.filter((d) => d.outcomeVerdict === "mixed").length;
    buckets.push({
      confidence: c,
      count: inBucket.length,
      worked,
      mixed,
      failed: inBucket.length - worked - mixed,
      // Mixed counts as a half.
      realisedPct: ((worked + mixed * 0.5) / inBucket.length) * 100,
      decisions: inBucket,
    });
  }
  return buckets;
}

/**
 * Patterns are computed, not generated. A card only appears if its rule actually
 * fires on this book's history, and every card names the decisions behind it.
 */
export function getPatterns(asOf?: string): Pattern[] {
  const out: Pattern[] = [];
  const decisions = listDecisions({ asOf });
  const resolved = decisions.filter((d) => d.outcomeVerdict);
  const events = listEvents({ asOf }).filter((e) => e.outcome);

  // Confidence vs realised outcome. Needs enough decisions in both buckets to
  // be worth stating at all — two decisions cannot establish a tendency.
  const buckets = getCalibration(asOf);
  const high = buckets.filter((b) => b.confidence >= 4);
  const mid = buckets.filter((b) => b.confidence === 3);
  const hN = high.reduce((s, b) => s + b.count, 0);
  const mN = mid.reduce((s, b) => s + b.count, 0);
  if (hN >= MIN_N && mN >= MIN_N) {
    const hRate = weighted(high);
    const mRate = weighted(mid);
    if (hRate <= mRate + 5) {
      const strictlyWorse = hRate < mRate;
      out.push({
        id: "pat_calibration",
        title: strictlyWorse
          ? "Your confidence does not sort your outcomes"
          : "Your confidence barely sorts your outcomes",
        finding: `Decisions you rated 4–5 out of 5 (n=${hN}) realised ${Math.round(hRate)}% of what you hoped for. Decisions you rated 3 (n=${mN}) realised ${Math.round(mRate)}%. ${
          strictlyWorse
            ? "Higher stated conviction has produced worse results in this book."
            : "The gap is inside the noise a book this small can resolve."
        }`,
        soWhat:
          "Confidence is currently closer to a measure of how much you like the idea than of how likely it is. Until it separates outcomes, using it to size positions transmits enthusiasm into risk.",
        evidence: [...high, ...mid].flatMap((b) => b.decisions),
      });
    }
  }

  // Adding into a thesis that was already weakening.
  const adds = decisions.filter((d) => d.type === "add" && d.positionId);
  const addsIntoWeakness = adds.filter((d) => {
    const t = getThesisAt(d.positionId!, justBefore(d.occurredAt));
    return t ? t.assumptions.filter((a) => a.status !== "intact").length >= 2 : false;
  });
  if (addsIntoWeakness.length > 0) {
    const bad = addsIntoWeakness.filter((d) => d.outcomeVerdict === "did_not_work");
    const clean = adds.filter((d) => !addsIntoWeakness.includes(d));
    const cleanBad = clean.filter((d) => d.outcomeVerdict === "did_not_work");
    out.push({
      id: "pat_add_weak",
      title: "You add when the thesis is already weakening",
      finding:
        `${addsIntoWeakness.length} of your ${adds.length} add${adds.length === 1 ? "" : "s"} ${addsIntoWeakness.length === 1 ? "was" : "were"} made into a thesis that already had two or more assumptions no longer intact` +
        (bad.length
          ? `, and ${bad.length === addsIntoWeakness.length ? (addsIntoWeakness.length === 1 ? "you later judged it" : "you later judged every one of them") : `${bad.length} of those you later judged`} did not work`
          : "") +
        `. ${
          clean.length === 0
            ? "You have no adds into a fully intact thesis to compare against."
            : `Of your ${clean.length} add${clean.length === 1 ? "" : "s"} into an intact thesis, ${cleanBad.length} did not work.`
        }`,
      soWhat:
        "An add condition written as a price level and a weakening assumption set can be satisfied at the same moment — which is exactly when adding feels most obvious and is least justified.",
      evidence: addsIntoWeakness,
    });
  }

  // Reductions recorded without a stated reversal condition. Deliberately does
  // not claim anything about whether trim conditions were met — that used to be
  // asserted in prose and was not computed.
  const cuts = decisions.filter((d) => d.type === "reduce" || d.type === "exit");
  const noTrigger = cuts.filter((d) => (d.reversalTrigger ?? "").trim().length === 0);
  const regrettedCuts = cuts.filter((d) => d.outcomeVerdict === "did_not_work");
  if (cuts.length >= MIN_N && (noTrigger.length > 0 || regrettedCuts.length > 0)) {
    const parts: string[] = [];
    if (noTrigger.length)
      parts.push(
        `${noTrigger.length} of ${cuts.length} recorded no condition that would reverse ${noTrigger.length === 1 ? "it" : "them"}`
      );
    if (regrettedCuts.length)
      parts.push(
        `${regrettedCuts.length} you later judged did not work`
      );
    out.push({
      id: "pat_cut_early",
      title: "Your reductions are the least reviewable decisions you make",
      finding: `Across ${cuts.length} reductions and exits, ${parts.join(", and ")}.`,
      soWhat:
        "Discomfort with position size is a legitimate reason to trim. It is not the same reason as the thesis changing, and a reduction with no reversal condition cannot be reviewed later — only defended.",
      evidence: [...new Set([...regrettedCuts, ...noTrigger])],
    });
  }

  // Business forecasts vs market reactions.
  if (events.length >= MIN_N) {
    const rightVars = events.filter((e) => e.outcome!.rightVariables === "yes").length;
    const rightCall = events.filter((e) => e.outcome!.forecastAccurate === "yes").length;
    const surprised = events.filter((e) => e.outcome!.reactionSurprising !== "no").length;
    if (rightVars > rightCall || surprised > 0) {
      out.push({
        id: "pat_vars_vs_calls",
        title: "You pick the right variable more reliably than you call it",
        finding: `Across ${events.length} events you prepared for, you identified the variable that mattered ${rightVars} time${rightVars === 1 ? "" : "s"} but forecast its resolution correctly ${rightCall} time${rightCall === 1 ? "" : "s"}.${surprised ? ` The market reaction surprised you in ${surprised}.` : ""}`,
        soWhat:
          "Naming the right variable is the scarce skill and you have it. The value is in preparing conditional actions for each resolution, not in predicting which one arrives.",
        evidence: [],
        events,
      });
    }
  }

  // Plans written and then not followed. The action that was skipped is read out
  // of the scenarios rather than assumed.
  const notFollowed = events.filter((e) => e.outcome!.followedPlan !== "yes");
  if (notFollowed.length > 0 && events.length >= MIN_N) {
    const skipped = notFollowed
      .flatMap((e) => e.scenarios.map((s) => s.plannedAction ?? ""))
      .filter((a) => /\b(cut|reduce|trim|sell|exit|half position)\b/i.test(a));
    out.push({
      id: "pat_plan_drift",
      title: "The plans you break are the ones that ask you to act",
      finding:
        `In ${notFollowed.length} of ${events.length} resolved events you did not follow the action you had written down beforehand.` +
        (skipped.length
          ? ` ${skipped.length === notFollowed.length ? "In each case" : `In ${skipped.length} of them`} the pre-written action involved reducing the position.`
          : ""),
      soWhat:
        "A process that holds when it asks you to do nothing and slips when it asks you to sell is a specific, fixable failure — not a discipline problem in general.",
      evidence: [],
      events: notFollowed,
    });
  }

  // Decisions left hanging. Bounded by `asOf` like everything else in this file,
  // so rendering the page at a past date does not leak the present.
  const nowMs = new Date(asOf ?? new Date().toISOString()).getTime();
  const unresolved = decisions.filter(
    (d) => !d.outcomeVerdict && new Date(d.occurredAt).getTime() < nowMs - 60 * DAY
  );
  if (unresolved.length > 0) {
    out.push({
      id: "pat_unresolved",
      title: "Decisions without recorded outcomes",
      finding: `${unresolved.length} decision${unresolved.length === 1 ? " older than 60 days has" : "s older than 60 days have"} no outcome recorded, so ${unresolved.length === 1 ? "it is" : "they are"} invisible to everything on this page.`,
      soWhat:
        "Every pattern here is computed from decisions you closed the loop on. Unresolved decisions are not neutral — they quietly bias the picture toward the ones you were happy to revisit.",
      evidence: unresolved,
    });
  }

  return out;
}

function weighted(buckets: CalibrationBucket[]) {
  const n = buckets.reduce((s, b) => s + b.count, 0);
  return n === 0 ? 0 : buckets.reduce((s, b) => s + b.realisedPct * b.count, 0) / n;
}

// ── replay ────────────────────────────────────────────────────────────────

export function listReplayCandidates(): Array<{ decision: Decision; position: Position | null }> {
  const rows = getDb()
    .prepare("select * from decisions where occurredAt < ? order by occurredAt desc")
    .all(new Date().toISOString()) as Record<string, unknown>[];
  return rows.map((r) => {
    const decision = toDecision(r);
    return {
      decision,
      position: decision.positionId
        ? ((getDb().prepare("select * from positions where id=?").get(decision.positionId) as Position) ?? null)
        : null,
    };
  });
}

export function listReplayAttempts(decisionId: string): ReplayAttempt[] {
  return getDb()
    .prepare("select * from replay_attempts where decisionId=? order by createdAt desc")
    .all(decisionId) as ReplayAttempt[];
}

/**
 * Splits the world at a decision, along two different bounds — which is the
 * whole subtlety of this feature.
 *
 *   `market` (inclusive of the instant) — prices, evidence, events, and the
 *     thesis. All of it genuinely was knowable when the decision was taken, so
 *     hiding it makes the room emptier than the moment really was. Before this
 *     split, four of the demo's sealed rooms rendered completely blank and
 *     "Mark that day" showed the *previous* mark rather than the fill.
 *
 *   `own` (exclusive, 1 ms earlier) — the position size and the decision
 *     itself. These are the act being replayed; showing them gives the answer.
 *
 * The one exception is a `thesis_change`, where the same-instant thesis version
 * *is* the decision's product and has to be sealed with it.
 */
export function getReplayContext(decisionId: string): ReplayContext | null {
  const decision = getDecision(decisionId);
  if (!decision) return null;
  const market = decision.occurredAt;
  const own = justBefore(decision.occurredAt);
  const thesisBound = decision.type === "thesis_change" ? own : market;

  const position = decision.positionId ? getPositionSnapshot(decision.positionId, own) : null;
  const positionsThen = listPositions(own).filter(
    (p) => p.shares > EPS || p.id === decision.positionId
  );

  const upcoming = listEvents({ asOf: market })
    .filter((e) => e.occurredAt > market)
    .filter((e) => !decision.positionId || e.positionId === decision.positionId || e.positionId === null);

  const priceThen = position ? priceAt(position.id, market) : null;
  const priceNow = position ? priceAt(position.id) : null;

  return {
    decision,
    asOf: own,
    marketAsOf: market,
    position,
    positionsThen,
    thesisThen: decision.positionId ? getThesisAt(decision.positionId, thesisBound) : null,
    evidenceThen: decision.positionId ? listEvidence(decision.positionId, { asOf: market }) : [],
    upcomingThen: upcoming,
    beliefsThen: decision.positionId ? beliefsForPosition(decision.positionId, market) : [],
    priceThen,
    priceNow,
    priceChangePct: priceThen && priceNow ? (priceNow / priceThen - 1) * 100 : null,
    marksAfter: position ? marksFor(position.id, { after: decision.occurredAt }) : [],
    timelineAfter: decision.positionId
      ? getTimeline(decision.positionId, { after: decision.occurredAt })
      : [],
    attempts: listReplayAttempts(decisionId),
    postmortem: decision.positionId ? getPostmortemForPosition(decision.positionId) : null,
  };
}

// ── small shared formatters used inside generated copy ────────────────────

/** Signed, so a reversed pair shows up as a negative rather than silently as 0. */
export function daysBetween(a: string, b: string) {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / DAY);
}

/** "16 days" / "1 month" / "1.4 years" — never "1 days". */
function span(a: string, b: string) {
  return describeSpan(Math.abs(new Date(b).getTime() - new Date(a).getTime()));
}

function fmtPct(n: number) {
  return `${n.toFixed(1)}%`;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
