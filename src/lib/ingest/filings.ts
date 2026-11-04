import { getDb, newId, nowIso } from "../db";
import { getJson } from "./http";
import { finishRun, startRun } from "./runs";

/**
 * SEC filings for a position, from the per-company submissions feed.
 *
 * Two things come out of this. First, material filings become evidence on the
 * position's timeline, marked `origin='ingested'` so the record still shows what
 * you wrote versus what arrived on its own. Second, the *cadence* of past
 * periodic filings gives an estimated date for the next one — Yahoo's earnings
 * calendar now requires a session crumb and returns 401, so the honest
 * alternative is to derive it and label it an estimate.
 */

export type SubmissionsResponse = {
  cik?: string;
  name?: string;
  filings?: {
    recent?: {
      accessionNumber?: string[];
      form?: string[];
      filingDate?: string[];
      reportDate?: string[];
      primaryDocDescription?: string[];
      /** Exact public instant, ISO Z — what an honest knownAt is made of. */
      acceptanceDateTime?: string[];
      /** 8-K item codes, comma-separated (e.g. "2.02,9.01"). */
      items?: string[];
    };
  };
};

export interface Filing {
  accession: string;
  form: string;
  filedAt: string;
  periodEnd: string | null;
  description: string | null;
  /** Falls back to midday on the filing date when the feed omits it. */
  acceptedAt: string;
  items: string[];
}

/** Forms worth a line on a timeline. Form 4s are counted, not listed one by one. */
const MATERIAL = new Set(["8-K", "10-Q", "10-K", "10-K/A", "10-Q/A", "DEF 14A", "S-1", "424B4"]);
const PERIODIC = new Set(["10-Q", "10-K"]);

export function parseSubmissions(data: SubmissionsResponse): Filing[] {
  const r = data.filings?.recent;
  if (!r?.form || !r.filingDate) return [];
  const out: Filing[] = [];
  for (let i = 0; i < r.form.length; i++) {
    const form = r.form[i];
    const filed = r.filingDate[i];
    if (!form || !filed) continue;
    const filedAt = new Date(`${filed}T12:00:00.000Z`).toISOString();
    out.push({
      accession: r.accessionNumber?.[i] ?? `${form}-${filed}-${i}`,
      form,
      filedAt,
      periodEnd: r.reportDate?.[i] || null,
      description: r.primaryDocDescription?.[i] || null,
      acceptedAt: r.acceptanceDateTime?.[i] || filedAt,
      items: (r.items?.[i] ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    });
  }
  return out.sort((a, b) => b.filedAt.localeCompare(a.filedAt));
}

export interface ReportEstimate {
  nextAt: string;
  medianGapDays: number;
  basedOn: number;
  lastFiledAt: string;
}

/**
 * Estimates the next 10-Q/10-K date from the median gap between the last few.
 * Median rather than mean because one late filing should not drag the estimate.
 * Returns null when there is not enough history to say anything.
 */
export function estimateNextReport(filings: Filing[], minHistory = 3): ReportEstimate | null {
  const periodic = filings
    .filter((f) => PERIODIC.has(f.form))
    .sort((a, b) => b.filedAt.localeCompare(a.filedAt))
    .slice(0, 6);
  if (periodic.length < minHistory) return null;

  const gaps: number[] = [];
  for (let i = 0; i < periodic.length - 1; i++) {
    const days = Math.round(
      (new Date(periodic[i].filedAt).getTime() - new Date(periodic[i + 1].filedAt).getTime()) / 86_400_000
    );
    if (days > 0) gaps.push(days);
  }
  if (gaps.length === 0) return null;

  const sorted = [...gaps].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid];

  const last = periodic[0];
  return {
    nextAt: new Date(new Date(last.filedAt).getTime() + median * 86_400_000).toISOString(),
    medianGapDays: median,
    basedOn: periodic.length,
    lastFiledAt: last.filedAt,
  };
}

export async function fetchFilings(cik: string): Promise<Filing[]> {
  const padded = cik.replace(/\D/g, "").padStart(10, "0");
  const data = await getJson<SubmissionsResponse>(`https://data.sec.gov/submissions/CIK${padded}.json`);
  return parseSubmissions(data);
}

/** Human summary for a filing, used as the evidence headline. */
export function describeFiling(f: Filing): string {
  const period = f.periodEnd ? ` for the period ending ${f.periodEnd}` : "";
  switch (f.form) {
    case "10-Q":
      return `Quarterly report (10-Q) filed${period}`;
    case "10-K":
      return `Annual report (10-K) filed${period}`;
    case "8-K":
      return "Material event reported (8-K)";
    case "DEF 14A":
      return "Proxy statement filed (DEF 14A)";
    default:
      return `${f.form} filed${period}`;
  }
}

/**
 * Writes material filings onto the position as ingested evidence, and upserts an
 * estimated next-report event. Idempotent via `externalId`.
 */
export function storeFilings(
  positionId: string,
  portfolioId: string,
  ticker: string,
  filings: Filing[],
  opts: { since?: string; limit?: number; now?: string } = {}
): { evidence: number; estimated: ReportEstimate | null } {
  const db = getDb();
  const now = opts.now ?? nowIso();
  const since = opts.since ?? new Date(Date.parse(now) - 365 * 86_400_000).toISOString();
  const material = filings
    .filter((f) => MATERIAL.has(f.form) && f.filedAt >= since)
    .slice(0, opts.limit ?? 40);

  const insert = db.prepare(
    `insert into evidence (id,positionId,occurredAt,kind,source,title,body,stance,contradictsAssumptionId,createdAt,origin,externalId)
     values (?,?,?, 'fact', ?, ?, ?, 'neutral', null, ?, 'ingested', ?)
     on conflict(externalId) do nothing`
  );

  let n = 0;
  db.transaction(() => {
    for (const f of material) {
      const res = insert.run(
        newId("evd"),
        positionId,
        f.filedAt,
        "SEC EDGAR",
        `${ticker}: ${describeFiling(f)}`,
        f.description ? `Primary document: ${f.description}.` : null,
        nowIso(),
        `sec:${f.accession}`
      );
      if (res.changes > 0) n++;
    }
  })();

  const estimate = estimateNextReport(filings);
  if (estimate && estimate.nextAt > now) {
    db.prepare(
      `insert into events (id,portfolioId,positionId,title,kind,occurredAt,knownAt,status,marketExpects,
         iExpect,keyVariables,scenarios,outcome,resolvedAt,createdAt,estimated,externalId)
       values (?,?,?,?, 'earnings', ?,?, 'upcoming', null,null,'[]','[]',null,null,?,1,?)
       on conflict(externalId) do update set occurredAt=excluded.occurredAt`
    ).run(
      newId("ev"),
      portfolioId,
      positionId,
      `${ticker}: next periodic filing due (estimated)`,
      estimate.nextAt,
      nowIso(),
      nowIso(),
      `sec-next:${positionId}`
    );
  }

  return { evidence: n, estimated: estimate };
}

export async function syncFilings(
  positionId: string,
  portfolioId: string,
  ticker: string,
  cik: string
) {
  const run = startRun("sec-filings", ticker);
  try {
    const filings = await fetchFilings(cik);
    const result = storeFilings(positionId, portfolioId, ticker, filings);
    finishRun(
      run,
      true,
      `${result.evidence} new filings${result.estimated ? `, next est. ${result.estimated.nextAt.slice(0, 10)} (median ${result.estimated.medianGapDays}d)` : ""}`
    );
    return result;
  } catch (err) {
    finishRun(run, false, String(err));
    throw err;
  }
}
