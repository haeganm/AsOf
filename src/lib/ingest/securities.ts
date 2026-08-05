import { getDb, nowIso } from "../db";
import { getJson } from "./http";
import { startRun, finishRun } from "./runs";

/**
 * The investable universe. SEC publishes every filer's ticker and CIK as one
 * ~780 KB file, which is small enough to cache whole and gives us the CIK needed
 * to read filings later. Cached locally so symbol lookup keeps working offline.
 */

const UNIVERSE_URL = "https://www.sec.gov/files/company_tickers.json";
const REFRESH_AFTER_DAYS = 7;

type Row = { cik_str: number; ticker: string; title: string };

export interface Security {
  ticker: string;
  cik: string | null;
  name: string;
  exchange: string | null;
  kind: string | null;
}

export function universeSize(): number {
  return (getDb().prepare("select count(*) as n from securities").get() as { n: number }).n;
}

function ageInDays(): number | null {
  const r = getDb().prepare("select max(updatedAt) as at from securities").get() as {
    at: string | null;
  };
  if (!r.at) return null;
  return (Date.now() - new Date(r.at).getTime()) / 86_400_000;
}

export function needsRefresh(): boolean {
  const age = ageInDays();
  return age === null || age > REFRESH_AFTER_DAYS;
}

/** Downloads and caches the universe. Safe to call repeatedly; no-ops when fresh. */
export async function refreshUniverse(force = false): Promise<{ count: number; skipped: boolean }> {
  if (!force && !needsRefresh()) return { count: universeSize(), skipped: true };

  const db = getDb();
  const run = startRun("sec-universe", null);
  try {
    const data = await getJson<Record<string, Row>>(UNIVERSE_URL);
    const rows = Object.values(data).filter((r) => r?.ticker && r?.title);
    const at = nowIso();

    const upsert = db.prepare(
      `insert into securities (ticker,cik,name,exchange,kind,updatedAt) values (?,?,?,?,?,?)
       on conflict(ticker) do update set cik=excluded.cik, name=excluded.name, updatedAt=excluded.updatedAt`
    );
    db.transaction(() => {
      for (const r of rows) {
        upsert.run(r.ticker.toUpperCase(), String(r.cik_str).padStart(10, "0"), r.title, null, "equity", at);
      }
    })();

    finishRun(run, true, `${rows.length} symbols`);
    return { count: rows.length, skipped: false };
  } catch (err) {
    finishRun(run, false, String(err));
    throw err;
  }
}

/**
 * Local symbol search. Exact ticker first, then prefix, then name — which is how
 * people actually look a company up.
 */
export function searchSecurities(query: string, limit = 12): Security[] {
  const q = query.trim();
  if (q.length === 0) return [];
  const upper = q.toUpperCase();
  return getDb()
    .prepare(
      `select ticker, cik, name, exchange, kind from securities
       where ticker = ? or ticker like ? or name like ?
       order by case when ticker = ? then 0 when ticker like ? then 1 else 2 end, length(ticker), ticker
       limit ?`
    )
    .all(upper, `${upper}%`, `%${q}%`, upper, `${upper}%`, limit) as Security[];
}

export function getSecurity(ticker: string): Security | null {
  return (
    (getDb()
      .prepare("select ticker, cik, name, exchange, kind from securities where ticker=?")
      .get(ticker.toUpperCase()) as Security) ?? null
  );
}

/**
 * Yahoo's search endpoint, used only as a fallback for things SEC does not list:
 * ETFs, indices like ^TNX, and futures like HG=F. Never required.
 */
export async function searchYahoo(query: string): Promise<Security[]> {
  const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(
    query
  )}&quotesCount=10&newsCount=0`;
  type Quote = { symbol?: string; shortname?: string; longname?: string; exchDisp?: string; quoteType?: string };
  const data = await getJson<{ quotes?: Quote[] }>(url);
  return (data.quotes ?? [])
    .filter((q) => q.symbol)
    .map((q) => ({
      ticker: q.symbol!,
      cik: null,
      name: q.shortname ?? q.longname ?? q.symbol!,
      exchange: q.exchDisp ?? null,
      kind: q.quoteType?.toLowerCase() ?? null,
    }));
}
