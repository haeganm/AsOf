import { getDb, nowIso } from "../db";
import { recordSignal } from "../signals";
import type { Filing } from "./filings";
import { getJson, getText } from "./http";

/**
 * Insider buying from SEC Form 4 filings.
 *
 * Discovery costs nothing: the per-company submissions feed the ingest already
 * reads lists every Form 4 with its acceptance instant. Each new filing costs
 * two archive requests — the directory index to locate the ownership XML, then
 * the XML itself.
 *
 * Only open-market purchases (transaction code P) are kept. Sales are noise for
 * this purpose: insiders sell for a hundred reasons — diversification, taxes, a
 * divorce — but they buy in the open market for exactly one.
 *
 * Two signal kinds, thresholds as named constants below:
 *  - insider_buy_large: one filing's aggregated open-market buy at or above
 *    LARGE_BUY_USD.
 *  - insider_cluster_buy: a second distinct insider buying within
 *    CLUSTER_WINDOW_DAYS. Emitted once, when the threshold-crossing filing
 *    lands; the cluster only became knowable at that filing's acceptance
 *    instant, and later buys inside the window do not re-mint it.
 *
 * Parsing rules paid for elsewhere (do not "fix"):
 *  - Every numeric field is wrapped in <value> — EXCEPT transactionCode, which
 *    carries its text directly. Reading the code via <value> silently
 *    classifies every row as "not a trade".
 *  - A footnoted figure has only a <footnoteId/> — genuinely absent, not
 *    malformed. Unpriced shares are excluded from the notional rather than
 *    multiplied by an average they never traded at.
 *  - Same-code same-date rows are aggregated BEFORE the dollar threshold:
 *    thirty $1k split-lot fills are one $30k decision.
 *  - Roles come from the relationship flags, never from title text.
 *  - 4/A amendments are dropped.
 */

export const MIN_BUY_USD = 25_000; // floor for a buy to enter the cluster state at all
export const LARGE_BUY_USD = 250_000; // a single filing worth a signal on its own
export const CLUSTER_WINDOW_DAYS = 14;
export const CLUSTER_MIN_OWNERS = 2;

export interface Form4Owner {
  name: string;
  roles: string[]; // e.g. ["director"], ["officer: CFO"], ["10% owner"]
}

export interface Form4Buy {
  date: string; // transaction date, YYYY-MM-DD
  shares: number;
  pricedShares: number;
  avgPrice: number | null; // over priced lots only
  notional: number; // priced lots only
}

export interface Form4 {
  symbol: string | null;
  issuerName: string | null;
  owners: Form4Owner[];
  buys: Form4Buy[];
}

// ── pure parsing ──────────────────────────────────────────────────────────

const blockRe = (tag: string) => new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g");

function blocks(xml: string, tag: string): string[] {
  const out: string[] = [];
  for (const m of xml.matchAll(blockRe(tag))) out.push(m[1]);
  return out;
}

/** Text content of a tag, unwrapping an optional <value> layer. */
function val(xml: string, tag: string): string | null {
  const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(xml);
  if (!m) return null;
  const inner = m[1];
  const v = /<value>([\s\S]*?)<\/value>/.exec(inner);
  const raw = (v ? v[1] : inner).trim();
  // A footnote-only field has no value at all.
  if (raw.length === 0 || raw.startsWith("<")) return null;
  return raw;
}

function num(xml: string, tag: string): number | null {
  const raw = val(xml, tag);
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function flag(xml: string, tag: string): boolean {
  const raw = val(xml, tag);
  return raw === "1" || raw === "true";
}

export function parseForm4(xml: string): Form4 {
  const owners: Form4Owner[] = blocks(xml, "reportingOwner").map((o) => {
    const roles: string[] = [];
    if (flag(o, "isDirector")) roles.push("director");
    if (flag(o, "isOfficer")) {
      const title = val(o, "officerTitle");
      roles.push(title ? `officer: ${title}` : "officer");
    }
    if (flag(o, "isTenPercentOwner")) roles.push("10% owner");
    return { name: val(o, "rptOwnerName") ?? "(unnamed)", roles };
  });

  // Open-market buys from the non-derivative table only, aggregated per date.
  const byDate = new Map<string, { shares: number; pricedShares: number; notional: number }>();
  for (const t of blocks(xml, "nonDerivativeTransaction")) {
    // transactionCode carries its text directly — never <value>-wrapped.
    const code = /<transactionCode>\s*([A-Z])\s*<\/transactionCode>/.exec(t)?.[1];
    if (code !== "P") continue;
    const date = val(t, "transactionDate");
    const shares = num(t, "transactionShares");
    if (!date || !shares || shares <= 0) continue;
    const price = num(t, "transactionPricePerShare");

    const agg = byDate.get(date) ?? { shares: 0, pricedShares: 0, notional: 0 };
    agg.shares += shares;
    if (price !== null && price > 0) {
      agg.pricedShares += shares;
      agg.notional += shares * price;
    }
    byDate.set(date, agg);
  }

  const buys: Form4Buy[] = [...byDate.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, a]) => ({
      date,
      shares: a.shares,
      pricedShares: a.pricedShares,
      avgPrice: a.pricedShares > 0 ? a.notional / a.pricedShares : null,
      notional: a.notional,
    }));

  return {
    symbol: val(xml, "issuerTradingSymbol"),
    issuerName: val(xml, "issuerName"),
    owners,
    buys,
  };
}

// ── archive fetch ─────────────────────────────────────────────────────────

type DirIndex = { directory?: { item?: Array<{ name?: string }> } };

/** The raw ownership XML in a filing directory, skipping xslF345X* rendered views. */
export function ownershipXmlName(index: DirIndex): string | null {
  for (const item of index.directory?.item ?? []) {
    const name = item.name ?? "";
    if (name.toLowerCase().endsWith(".xml") && !name.includes("/") && !/^xsl/i.test(name)) {
      return name;
    }
  }
  return null;
}

async function fetchForm4(cik: string, accession: string): Promise<Form4 | null> {
  const cikNum = String(Number(cik.replace(/\D/g, "")));
  const dir = `https://www.sec.gov/Archives/edgar/data/${cikNum}/${accession.replace(/-/g, "")}`;
  const index = await getJson<DirIndex>(`${dir}/index.json`);
  const name = ownershipXmlName(index);
  if (!name) return null;
  return parseForm4(await getText(`${dir}/${name}`, { accept: "application/xml" }));
}

// ── sync ──────────────────────────────────────────────────────────────────

export interface InsiderSyncResult {
  /** First sight of this company: watermark seeded, nothing fetched. */
  seeded: boolean;
  processed: number;
  buys: number;
  signals: number;
}

/**
 * Process a company's new Form 4s from an already-fetched submissions list.
 *
 * The watermark (max processed acceptance instant, per company) is the
 * incremental state. It is initialised to NOW on first sight — deliberately: a
 * first run must not fetch a company's entire Form 4 history, and imported
 * history could never honestly enter the live scorecard anyway.
 */
export async function syncInsiders(
  symbol: string,
  cik: string,
  filings: Filing[]
): Promise<InsiderSyncResult> {
  const db = getDb();
  const row = db.prepare("select form4Watermark from universe where symbol=?").get(symbol) as
    | { form4Watermark: string | null }
    | undefined;

  const watermark = row?.form4Watermark ?? null;
  if (watermark === null) {
    db.prepare("update universe set form4Watermark=? where symbol=?").run(nowIso(), symbol);
    return { seeded: true, processed: 0, buys: 0, signals: 0 };
  }

  const fresh = filings
    .filter((f) => f.form === "4" && f.acceptedAt > watermark)
    .sort((a, b) => a.acceptedAt.localeCompare(b.acceptedAt));

  let processed = 0;
  let buys = 0;
  let signals = 0;
  let highWater = watermark;

  for (const f of fresh) {
    highWater = f.acceptedAt > highWater ? f.acceptedAt : highWater;
    processed++;
    let parsed: Form4 | null;
    try {
      parsed = await fetchForm4(cik, f.accession);
    } catch {
      // One unreadable filing must not stall the watermark forever; it is
      // recorded in the run note by the caller via the counts.
      continue;
    }
    if (!parsed) continue;
    const r = registerBuyFiling(symbol, f.accession, f.acceptedAt, parsed);
    buys += r.stored ? 1 : 0;
    signals += r.signals;
  }

  if (highWater > watermark) {
    db.prepare("update universe set form4Watermark=? where symbol=?").run(highWater, symbol);
  }
  return { seeded: false, processed, buys, signals };
}

/**
 * Record one parsed Form 4 into the cluster state and emit whatever signals it
 * justifies. Separated from the network path so the rules are testable offline.
 */
export function registerBuyFiling(
  symbol: string,
  accession: string,
  acceptedAt: string,
  parsed: Form4
): { stored: boolean; signals: number } {
  const db = getDb();
  if (parsed.buys.length === 0) return { stored: false, signals: 0 };

  const ownerNames = parsed.owners.map((o) => o.name).join("; ") || "(unnamed)";
  const roles = [...new Set(parsed.owners.flatMap((o) => o.roles))].join(", ");
  const total = parsed.buys.reduce((s, b) => s + b.notional, 0);
  const totalShares = parsed.buys.reduce((s, b) => s + b.shares, 0);
  const firstDate = parsed.buys[0].date;
  if (total < MIN_BUY_USD) return { stored: false, signals: 0 };

  // One row per owner so a joint filing counts each name toward a cluster.
  const insert = db.prepare(
    `insert into insider_buys (accession,ownerName,symbol,roles,shares,avgPrice,notional,transactionDate,acceptedAt,createdAt)
     values (?,?,?,?,?,?,?,?,?,?) on conflict do nothing`
  );
  for (const o of parsed.owners.length > 0 ? parsed.owners : [{ name: "(unnamed)", roles: [] }]) {
    insert.run(
      accession,
      o.name,
      symbol,
      o.roles.join(", "),
      totalShares,
      totalShares > 0 ? total / totalShares : null,
      total,
      firstDate,
      acceptedAt,
      nowIso()
    );
  }

  let signals = 0;
  const money = `$${Math.round(total).toLocaleString("en-US")}`;
  if (total >= LARGE_BUY_USD) {
    const id = recordSignal({
      source: "insider",
      kind: "insider_buy_large",
      symbol,
      direction: "long",
      firedAt: `${firstDate}T12:00:00.000Z`,
      knownAt: acceptedAt,
      title: `${ownerNames} bought ${money} of ${symbol} in the open market`,
      detail: roles ? `Role: ${roles}.` : null,
      externalId: `sig:insider:${accession}`,
    });
    if (id) signals++;
  }

  // Cluster check: distinct owners buying inside the window, counted at the
  // moment this filing made the cluster knowable.
  const windowStart = new Date(
    new Date(`${firstDate}T00:00:00.000Z`).getTime() - CLUSTER_WINDOW_DAYS * 86_400_000
  )
    .toISOString()
    .slice(0, 10);
  const distinct = (
    db
      .prepare(
        `select count(distinct ownerName) as n from insider_buys
         where symbol=? and transactionDate between ? and ?`
      )
      .get(symbol, windowStart, firstDate) as { n: number }
  ).n;

  if (distinct >= CLUSTER_MIN_OWNERS) {
    const recentCluster = db
      .prepare(
        `select 1 as ok from signals where kind='insider_cluster_buy' and symbol=? and knownAt >= ? limit 1`
      )
      .get(symbol, new Date(Date.parse(acceptedAt) - CLUSTER_WINDOW_DAYS * 86_400_000).toISOString());
    if (!recentCluster) {
      const id = recordSignal({
        source: "insider",
        kind: "insider_cluster_buy",
        symbol,
        direction: "long",
        firedAt: `${firstDate}T12:00:00.000Z`,
        knownAt: acceptedAt,
        title: `${distinct} insiders bought ${symbol} in the open market within ${CLUSTER_WINDOW_DAYS} days`,
        detail: `Latest: ${ownerNames}, ${money}.`,
        externalId: `sig:insider-cluster:${symbol}:${accession}`,
      });
      if (id) signals++;
    }
  }
  return { stored: true, signals };
}
