import { getDb, newId, nowIso } from "./db";
import { symbolSeriesId } from "./correlation-report";
import { grade, isHit, lastPerDay, HORIZONS, type DailyBar } from "./grade";
import { wilson, MIN_FOR_CLAIM, type Interval } from "./stats";

/**
 * The signal spine.
 *
 * A signal is any timestamped, sealed claim that something notable happened for
 * a symbol — an insider cluster buy, an 8-K, a monitor firing, an imported
 * alert, one of your own decisions. They all land in one append-only table, and
 * everything downstream (the scorecard, the studies, the Today brief) is a read
 * over that table. No source is special.
 */

export type SignalDirection = "long" | "short" | "info";

export interface Signal {
  id: string;
  source: string;
  kind: string;
  symbol: string;
  direction: SignalDirection;
  firedAt: string;
  knownAt: string;
  sealedAt: string;
  backfilled: number;
  title: string;
  detail: string | null;
  externalId: string | null;
  meta: string;
}

export const SOURCE_LABEL: Record<string, string> = {
  insider: "Insider buys (SEC Form 4)",
  filing: "Company filings (SEC 8-K)",
  monitor: "Your monitors",
  journal: "Your own decisions",
};

/** Plain-language names for signal kinds; grows with each source. */
export const KIND_LABEL: Record<string, string> = {
  insider_buy_large: "Large insider buy",
  insider_cluster_buy: "Insider cluster buy",
  monitor_price_level: "Monitor: price level crossed",
  monitor_price_change: "Monitor: price move",
  monitor_drawdown: "Monitor: drawdown",
  monitor_series_level: "Monitor: macro level crossed",
  monitor_series_change: "Monitor: macro move",
  monitor_deadline: "Monitor: date passed",
  journal_open: "You opened a position",
  journal_add: "You added",
  journal_reduce: "You reduced",
  journal_exit: "You exited",
  journal_pass: "You passed",
};

export function sourceLabel(source: string): string {
  if (source.startsWith("import:")) return `Imported: ${source.slice(7)}`;
  return SOURCE_LABEL[source] ?? source;
}

export function kindLabel(kind: string): string {
  return KIND_LABEL[kind] ?? kind;
}

/** Sealed more than this long after it was knowable = imported history, not live collection. */
const BACKFILL_GRACE_MS = 72 * 3_600_000;

/**
 * Append one signal, idempotently. Returns the id, or null when the externalId
 * already exists (re-ingesting is a no-op, never a duplicate).
 */
export function recordSignal(input: {
  source: string;
  kind: string;
  symbol: string;
  direction: SignalDirection;
  firedAt: string;
  knownAt: string;
  title: string;
  detail?: string | null;
  externalId?: string | null;
  meta?: Record<string, unknown>;
  /** Force the flag; otherwise derived from how stale knownAt is at sealing time. */
  backfilled?: boolean;
}): string | null {
  const sealedAt = nowIso();
  const backfilled =
    input.backfilled ?? Date.parse(sealedAt) - Date.parse(input.knownAt) > BACKFILL_GRACE_MS;
  const id = newId("sig");
  const res = getDb()
    .prepare(
      `insert into signals (id,source,kind,symbol,direction,firedAt,knownAt,sealedAt,backfilled,title,detail,externalId,meta)
       values (?,?,?,?,?,?,?,?,?,?,?,?,?)
       on conflict(externalId) do nothing`
    )
    .run(
      id,
      input.source,
      input.kind,
      input.symbol.toUpperCase(),
      input.direction,
      input.firedAt,
      input.knownAt,
      sealedAt,
      backfilled ? 1 : 0,
      input.title,
      input.detail ?? null,
      input.externalId ?? null,
      JSON.stringify(input.meta ?? {})
    );
  return res.changes > 0 ? id : null;
}

export interface SignalFilter {
  source?: string;
  kind?: string;
  symbol?: string;
  since?: string;
  limit?: number;
}

export function listSignals(filter: SignalFilter = {}): Signal[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filter.source !== undefined && filter.source !== "") {
    clauses.push("source = ?");
    params.push(filter.source);
  }
  if (filter.kind !== undefined && filter.kind !== "") {
    clauses.push("kind = ?");
    params.push(filter.kind);
  }
  if (filter.symbol !== undefined && filter.symbol !== "") {
    clauses.push("symbol = ?");
    params.push(filter.symbol.toUpperCase());
  }
  if (filter.since !== undefined && filter.since !== "") {
    clauses.push("knownAt >= ?");
    params.push(filter.since);
  }
  const where = clauses.length > 0 ? `where ${clauses.join(" and ")}` : "";
  params.push(filter.limit ?? 200);
  return getDb()
    .prepare(`select * from signals ${where} order by knownAt desc limit ?`)
    .all(...params) as Signal[];
}

export function getSignal(id: string): Signal | null {
  return (getDb().prepare("select * from signals where id=?").get(id) as Signal | undefined) ?? null;
}

export interface Outcome {
  signalId: string;
  horizonDays: number;
  entryAt: string;
  exitAt: string;
  signalReturn: number;
  benchmarkReturn: number;
  excessReturn: number;
  computedAt: string;
}

export function outcomesFor(signalId: string): Outcome[] {
  return getDb()
    .prepare("select * from signal_outcomes where signalId=? order by horizonDays")
    .all(signalId) as Outcome[];
}

export const BENCHMARK = "SPY";

function dailyBars(symbol: string): DailyBar[] {
  return lastPerDay(
    getDb()
      .prepare("select occurredAt as at, price as close from marks where positionId=? order by occurredAt")
      .all(symbolSeriesId(symbol)) as DailyBar[]
  );
}

/**
 * Grade every signal that is missing outcome rows for elapsed horizons. Runs in
 * the daily ingest after prices refresh. Idempotent: an existing (signal,
 * horizon) row is never touched, and a horizon that cannot yet be graded writes
 * nothing at all.
 */
export function computeOutcomes(): { graded: number; pending: number; ungraded: number } {
  const db = getDb();
  const bench = dailyBars(BENCHMARK);
  const stats = { graded: 0, pending: 0, ungraded: 0 };
  if (bench.length === 0) return stats; // no benchmark yet — nothing can grade

  const missing = db
    .prepare(
      `select s.* from signals s
       where (select count(*) from signal_outcomes o where o.signalId = s.id) < ?
       order by s.symbol`
    )
    .all(HORIZONS.length) as Signal[];

  const insert = db.prepare(
    `insert into signal_outcomes (signalId,horizonDays,entryAt,exitAt,signalReturn,benchmarkReturn,excessReturn,computedAt)
     values (?,?,?,?,?,?,?,?) on conflict do nothing`
  );

  let cachedSymbol = "";
  let cachedBars: DailyBar[] = [];
  for (const s of missing) {
    if (cachedSymbol !== s.symbol) {
      cachedSymbol = s.symbol;
      cachedBars = dailyBars(s.symbol);
    }
    const have = new Set(outcomesFor(s.id).map((o) => o.horizonDays));
    for (const h of HORIZONS) {
      if (have.has(h)) continue;
      const g = grade(cachedBars, bench, s.knownAt, h);
      if (g.status === "graded") {
        insert.run(s.id, h, g.entryAt, g.exitAt, g.signalReturn, g.benchmarkReturn, g.excessReturn, nowIso());
        stats.graded++;
      } else if (g.status === "pending") stats.pending++;
      else stats.ungraded++;
    }
  }
  return stats;
}

// ---------------------------------------------------------------------------
// Aggregation — the scorecard and the studies are the same read with a
// different group key and a different backfill rule.
// ---------------------------------------------------------------------------

export interface GradeRow {
  key: string; // source or kind
  direction: SignalDirection | "mixed";
  horizonDays: number;
  n: number;
  hits: number | null; // null for info signals — no direction, no hit rate
  hitInterval: Interval | null;
  medianExcess: number;
  q1Excess: number;
  q3Excess: number;
  firstKnownAt: string;
  ungraded: number;
}

export interface GroupSummary {
  key: string;
  total: number; // signals in the group (graded or not)
  firstKnownAt: string;
  rows: GradeRow[]; // one per horizon that has any outcomes
  ungraded: number; // signals that can never grade (dead series)
}

/**
 * Grade a family of signals grouped by `source` (the scorecard: live-collected
 * only, is there edge?) or by `kind` (the studies: backfill included, what
 * usually happens?).
 */
export function aggregateSignals(
  groupBy: "source" | "kind",
  opts: { includeBackfilled: boolean }
): GroupSummary[] {
  const db = getDb();
  const backfillClause = opts.includeBackfilled ? "" : "and s.backfilled = 0";

  const groups = db
    .prepare(
      `select s.${groupBy} as key, count(*) as total, min(s.knownAt) as firstKnownAt
       from signals s where 1=1 ${backfillClause}
       group by s.${groupBy} order by key`
    )
    .all() as Array<{ key: string; total: number; firstKnownAt: string }>;

  const outcomeRows = db
    .prepare(
      `select s.${groupBy} as key, s.direction, o.horizonDays, o.excessReturn, s.knownAt
       from signal_outcomes o join signals s on s.id = o.signalId
       where 1=1 ${backfillClause}`
    )
    .all() as Array<{ key: string; direction: SignalDirection; horizonDays: number; excessReturn: number; knownAt: string }>;

  // A signal is "ungraded" when its symbol series died: it has fewer outcome
  // rows than horizons whose exit dates have long passed. Cheap proxy that
  // avoids re-running grade(): older than a year with no outcomes at all.
  const yearAgo = new Date(Date.now() - 366 * 86_400_000).toISOString();
  const deadCounts = db
    .prepare(
      `select s.${groupBy} as key, count(*) as n from signals s
       where s.knownAt < ? ${backfillClause}
         and not exists (select 1 from signal_outcomes o where o.signalId = s.id)
       group by s.${groupBy}`
    )
    .all(yearAgo) as Array<{ key: string; n: number }>;
  const dead = new Map(deadCounts.map((d) => [d.key, d.n]));

  return groups.map((g) => {
    const mine = outcomeRows.filter((r) => r.key === g.key);
    const horizons = [...new Set(mine.map((r) => r.horizonDays))].sort((a, b) => a - b);
    const rows: GradeRow[] = horizons.map((h) => {
      const at = mine.filter((r) => r.horizonDays === h);
      const excess = at.map((r) => r.excessReturn).sort((a, b) => a - b);
      const directions = new Set(at.map((r) => r.direction));
      const directional = at.filter((r) => r.direction !== "info");
      const hits = directional.length > 0 ? directional.filter((r) => isHit(r.direction, r.excessReturn) === true).length : null;
      return {
        key: g.key,
        direction: directions.size === 1 ? [...directions][0] : "mixed",
        horizonDays: h,
        n: at.length,
        hits,
        hitInterval: hits !== null ? wilson(hits, directional.length) : null,
        medianExcess: quantile(excess, 0.5),
        q1Excess: quantile(excess, 0.25),
        q3Excess: quantile(excess, 0.75),
        firstKnownAt: at.reduce((min, r) => (r.knownAt < min ? r.knownAt : min), at[0].knownAt),
        ungraded: dead.get(g.key) ?? 0,
      };
    });
    return { key: g.key, total: g.total, firstKnownAt: g.firstKnownAt, rows, ungraded: dead.get(g.key) ?? 0 };
  });
}

export { MIN_FOR_CLAIM };

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
