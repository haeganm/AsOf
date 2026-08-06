import { getDb, newId } from "../db";
import { getJson } from "./http";
import { finishRun, startRun } from "./runs";

/**
 * Daily closes from Yahoo's chart endpoint into `marks`.
 *
 * `marks` was originally a handful of prices the user typed. It is now a real
 * price series, which is what makes returns, weights, drawdowns and the
 * correlation check possible. Manual marks are never overwritten by a fetched
 * one — a recorded fill is a fact about your execution, not an estimate.
 */

export interface Bar {
  occurredAt: string;
  close: number;
}

export type ChartResponse = {
  chart: {
    result?: Array<{
      meta?: { symbol?: string; currency?: string };
      timestamp?: number[];
      indicators?: { quote?: Array<{ close?: Array<number | null> }> };
    }>;
    error?: { code?: string; description?: string } | null;
  };
};

/** `range=max` returns a coarse, aggregated series — always ask for a real range. */
export type Range = "1mo" | "6mo" | "1y" | "2y" | "5y" | "10y";

/**
 * Pure parse, separate from the fetch so it can be tested against a recorded
 * response rather than the live endpoint.
 */
export function parseChart(data: ChartResponse, symbol = "?"): Bar[] {
  const res = data.chart?.result?.[0];
  if (!res) throw new Error(data.chart?.error?.description ?? `no data for ${symbol}`);

  const ts = res.timestamp ?? [];
  const closes = res.indicators?.quote?.[0]?.close ?? [];
  const out: Bar[] = [];
  for (let i = 0; i < ts.length; i++) {
    const close = closes[i];
    // Yahoo pads holidays and trading halts with nulls.
    if (close === null || close === undefined || !Number.isFinite(close)) continue;
    out.push({ occurredAt: new Date(ts[i] * 1000).toISOString(), close });
  }
  // A response can arrive with timestamps out of order after a splice.
  return out.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
}

export async function fetchBars(symbol: string, range: Range = "5y", interval = "1d"): Promise<Bar[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    symbol
  )}?range=${range}&interval=${interval}`;
  return parseChart(await getJson<ChartResponse>(url), symbol);
}

/** Writes bars into `marks`, leaving any manually recorded price in place. */
export function storeBars(positionId: string, bars: Bar[]): number {
  const db = getDb();
  const insert = db.prepare(
    `insert into marks (id,positionId,occurredAt,price,source) values (?,?,?,?,'yahoo')
     on conflict(positionId,occurredAt) do update set
       price = case when marks.source = 'manual' then marks.price else excluded.price end`
  );
  let n = 0;
  db.transaction(() => {
    for (const b of bars) {
      insert.run(newId("mk"), positionId, b.occurredAt, b.close);
      n++;
    }
  })();
  return n;
}

/**
 * Backfills a position's price history, then keeps it current. Chooses the
 * smallest range that covers what is missing.
 */
export async function syncPrices(
  positionId: string,
  symbol: string,
  opts: { full?: boolean } = {}
): Promise<{ stored: number; range: Range }> {
  const db = getDb();
  const run = startRun("yahoo-prices", symbol);
  try {
    const latest = (
      db
        .prepare("select max(occurredAt) as at from marks where positionId=? and source='yahoo'")
        .get(positionId) as { at: string | null }
    ).at;

    const daysStale = latest ? (Date.now() - new Date(latest).getTime()) / 86_400_000 : Infinity;
    const range: Range = opts.full || daysStale > 330 ? "5y" : daysStale > 25 ? "1y" : "1mo";

    const bars = await fetchBars(symbol, range);
    const stored = storeBars(positionId, bars);
    finishRun(run, true, `${stored} bars over ${range}`);
    return { stored, range };
  } catch (err) {
    finishRun(run, false, String(err));
    throw err;
  }
}

/**
 * Removes stale duplicate-date rows from the sym_* series: when two fetched
 * marks share a calendar date, only the latest-stamped survives. Legacy weekly
 * bars (04:00 stamp, week's closing price) beside daily bars (13:30 stamp,
 * that day's close) would otherwise hand the grader a close from days in the
 * future. Manual marks are never touched. Idempotent, runs after every sync.
 */
export function dedupeSymbolDays(): number {
  return getDb()
    .prepare(
      `delete from marks where positionId like 'sym!_%' escape '!' and source != 'manual'
       and exists (
         select 1 from marks m2
         where m2.positionId = marks.positionId
           and substr(m2.occurredAt, 1, 10) = substr(marks.occurredAt, 1, 10)
           and m2.occurredAt > marks.occurredAt
       )`
    )
    .run().changes;
}

/**
 * Weekly closes, sampled from whatever daily marks exist. Used by the correlation
 * check — weekly returns are less noisy than daily and tolerate the odd gap.
 */
export function weeklySeries(positionId: string, weeks = 104): Array<{ at: string; close: number }> {
  const rows = getDb()
    .prepare("select occurredAt, price from marks where positionId=? order by occurredAt")
    .all(positionId) as Array<{ occurredAt: string; price: number }>;

  const byWeek = new Map<string, { at: string; close: number }>();
  for (const r of rows) {
    const d = new Date(r.occurredAt);
    // ISO-ish week key: year plus week number, so the last print of each week wins.
    const week = Math.floor((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 1)) / (7 * 86_400_000));
    byWeek.set(`${d.getUTCFullYear()}-${String(week).padStart(2, "0")}`, {
      at: r.occurredAt,
      close: r.price,
    });
  }
  return [...byWeek.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-weeks)
    .map(([, v]) => v);
}
