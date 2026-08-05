import { getDb } from "./db";
import { buildReport, type CorrelationReport, type Series } from "./correlation";
import { weeklySeries } from "./ingest/prices";
import { listPositions } from "./queries";
import type { PositionBelief } from "./types";

/**
 * Assembles the correlation check from what is in the book.
 *
 * One decision matters here: correlation is read from **real prices for the
 * symbol**, not from the position's own marks. How two securities move together
 * is a property of the market, not of your fills — which also means the check
 * works on the sample book, whose fictional price path is deliberately left
 * alone. Real series are stored against a reserved pseudo-position id so they
 * reuse the same ingestion path, the same table and the same as-of bounds.
 *
 * The maths stays in `correlation.ts` and is pure; only this layer touches the
 * database.
 */

/**
 * Macro proxies for beliefs, as free Yahoo symbols. Kept here rather than on the
 * beliefs table because a proxy is a property of the *driver*, not of the user's
 * opinion about it — and a badly chosen proxy should be visible and changeable
 * in one place.
 */
export const BELIEF_PROXIES: Record<string, { symbol: string; label: string }> = {
  bl_rates: { symbol: "^TNX", label: "10-year Treasury yield" },
  bl_china: { symbol: "HG=F", label: "Copper futures" },
  bl_packaging: { symbol: "SMH", label: "Semiconductor ETF" },
};

/** Reserved marks key for a symbol's real price history. */
export function symbolSeriesId(symbol: string) {
  return `sym_${symbol.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
}

export interface CheckResult extends CorrelationReport {
  /** No pair had enough shared history to say anything. */
  insufficient: boolean;
  seriesCovered: number;
  /** Symbols with no real price history cached yet. */
  missing: string[];
}

export function getCorrelationCheck(): CheckResult {
  const db = getDb();
  const held = listPositions().filter((p) => p.shares > 0.0001);

  const series: Series[] = [];
  const missing: string[] = [];

  for (const p of held) {
    const points = weeklySeries(symbolSeriesId(p.ticker));
    if (points.length === 0) {
      missing.push(p.ticker);
      continue;
    }
    series.push({ key: p.id, label: p.ticker, points });
  }

  const links = db.prepare("select * from position_beliefs").all() as PositionBelief[];
  const beliefNames = new Map(
    (db.prepare("select id, name from beliefs").all() as Array<{ id: string; name: string }>).map(
      (b) => [b.id, b.name]
    )
  );
  const covered = new Set(series.map((s) => s.key));

  // Belief proxies join the matrix as extra series.
  const proxies: Array<{ positionKey: string; proxyKey: string; beliefName: string }> = [];
  for (const [beliefId, proxy] of Object.entries(BELIEF_PROXIES)) {
    const users = links.filter((l) => l.beliefId === beliefId && covered.has(l.positionId));
    if (users.length === 0) continue;
    const key = `proxy:${proxy.symbol}`;
    if (!series.some((s) => s.key === key)) {
      const points = weeklySeries(symbolSeriesId(proxy.symbol));
      if (points.length === 0) {
        missing.push(proxy.symbol);
        continue;
      }
      series.push({ key, label: proxy.label, points });
    }
    for (const l of users) {
      proxies.push({
        positionKey: l.positionId,
        proxyKey: key,
        beliefName: beliefNames.get(beliefId) ?? beliefId,
      });
    }
  }

  // Every pair the investor has declared to share a belief.
  const declared: Array<[string, string, string]> = [];
  const seen = new Set<string>();
  for (const beliefId of new Set(links.map((l) => l.beliefId))) {
    const inBelief = links
      .filter((l) => l.beliefId === beliefId && covered.has(l.positionId))
      .map((l) => l.positionId);
    for (let i = 0; i < inBelief.length; i++) {
      for (let j = i + 1; j < inBelief.length; j++) {
        const k = [inBelief[i], inBelief[j]].sort().join("|") + `|${beliefId}`;
        if (seen.has(k)) continue;
        seen.add(k);
        declared.push([inBelief[i], inBelief[j], beliefNames.get(beliefId) ?? beliefId]);
      }
    }
  }

  const report = buildReport(series, declared, proxies);
  return {
    ...report,
    seriesCovered: series.length - report.excluded.length,
    missing: [...new Set(missing)],
    insufficient: report.matrix.length === 0,
  };
}

/** Symbols the correlation check wants real history for. */
export function symbolsToTrack(): string[] {
  const db = getDb();
  const tickers = (
    db.prepare("select distinct ticker from positions").all() as Array<{ ticker: string }>
  ).map((r) => r.ticker);
  const links = db.prepare("select distinct beliefId from position_beliefs").all() as Array<{
    beliefId: string;
  }>;
  const proxies = links
    .map((l) => BELIEF_PROXIES[l.beliefId]?.symbol)
    .filter((s): s is string => Boolean(s));
  return [...new Set([...tickers, ...proxies])];
}
