/**
 * Checks the belief graph against the tape.
 *
 * The belief matrix is what the investor *says* connects their positions. With
 * real price history we can ask whether the market agrees, and the answer is
 * sometimes no — the demo's DLR thesis calls itself "a levered short on long
 * rates" while DLR's realised correlation to the 10-year yield is about −0.05.
 *
 * Everything here is pure so it can be tested against recorded prices. It is
 * deliberately conservative about what it claims: correlation is not causation,
 * a moderate coefficient is not "the same position", and any finding below the
 * sample-size floor is withheld rather than hedged.
 */

export interface Series {
  key: string;
  label: string;
  points: Array<{ at: string; close: number }>;
}

/** Weekly log-ish returns keyed by week, so two series can be aligned by date. */
export function returnsByWeek(points: Array<{ at: string; close: number }>): Map<string, number> {
  const out = new Map<string, number>();
  const sorted = [...points].sort((a, b) => a.at.localeCompare(b.at));
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1].close;
    const cur = sorted[i].close;
    if (!(prev > 0) || !(cur > 0)) continue;
    out.set(weekKey(sorted[i].at), cur / prev - 1);
  }
  return out;
}

export function weekKey(iso: string): string {
  const d = new Date(iso);
  const week = Math.floor((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 1)) / (7 * 86_400_000));
  return `${d.getUTCFullYear()}-${String(week).padStart(2, "0")}`;
}

export interface Pairwise {
  r: number;
  n: number;
}

/**
 * Pearson correlation over the weeks the two series share. Returns n so the
 * caller can refuse to draw a conclusion from a short overlap.
 */
export function correlate(a: Map<string, number>, b: Map<string, number>): Pairwise {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [k, v] of a) {
    const w = b.get(k);
    if (w === undefined) continue;
    xs.push(v);
    ys.push(w);
  }
  const n = xs.length;
  if (n < 2) return { r: 0, n };

  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const px = xs[i] - mx;
    const py = ys[i] - my;
    num += px * py;
    dx += px * px;
    dy += py * py;
  }
  // A constant series has no variance and therefore no correlation to report.
  if (dx === 0 || dy === 0) return { r: 0, n };
  return { r: clampR(num / Math.sqrt(dx * dy)), n };
}

function clampR(r: number) {
  if (!Number.isFinite(r)) return 0;
  return Math.max(-1, Math.min(1, Math.round(r * 1000) / 1000));
}

/** Below this the overlap is too short to say anything, so we say nothing. */
export const MIN_WEEKS = 40;
/** Read as "these move together more than the rest of the book", not "same bet". */
export const TOGETHER = 0.3;
/** Below this, a declared connection is not visible in the price at all. */
export const APART = 0.15;

export interface CorrelationFinding
  extends Pairwise {
  kind: "declared-but-apart" | "correlated-but-undeclared" | "proxy-mismatch";
  a: string;
  b: string;
  aLabel: string;
  bLabel: string;
  /** The belief the pair was declared under, when there is one. */
  via?: string;
  headline: string;
  detail: string;
}

export interface CorrelationReport {
  matrix: Array<{ a: string; b: string; r: number; n: number }>;
  findings: CorrelationFinding[];
  weeksCovered: number;
  /** Series that had too little history to include, named so the gap is visible. */
  excluded: string[];
  /** Key to display label, so the UI never has to infer one from an id. */
  labels: Record<string, string>;
}

/**
 * @param series      one per position, plus one per belief proxy symbol
 * @param declared    pairs the investor says share a belief: [a, b, beliefName]
 * @param proxies     belief proxy series keyed by the positions that claim them
 */
export function buildReport(
  series: Series[],
  declared: Array<[string, string, string]>,
  proxies: Array<{ positionKey: string; proxyKey: string; beliefName: string }> = []
): CorrelationReport {
  const returns = new Map<string, Map<string, number>>();
  const excluded: string[] = [];
  for (const s of series) {
    const r = returnsByWeek(s.points);
    if (r.size < MIN_WEEKS) excluded.push(s.label);
    else returns.set(s.key, r);
  }
  const label = new Map(series.map((s) => [s.key, s.label]));

  const matrix: CorrelationReport["matrix"] = [];
  const keys = [...returns.keys()];
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const { r, n } = correlate(returns.get(keys[i])!, returns.get(keys[j])!);
      matrix.push({ a: keys[i], b: keys[j], r, n });
    }
  }

  const findings: CorrelationFinding[] = [];
  const declaredPairs = new Set(declared.map(([a, b]) => pairKey(a, b)));
  // Proxies are macro yardsticks, not holdings. "NVDA moves with a semiconductor
  // ETF" is arithmetic, not an insight, so they are only used for the explicit
  // proxy-mismatch check below.
  const proxyKeys = new Set(proxies.map((p) => p.proxyKey));

  // 1. Declared together, but the prices do not move together.
  for (const [a, b, belief] of declared) {
    const cell = matrix.find((m) => pairKey(m.a, m.b) === pairKey(a, b));
    if (!cell || cell.n < MIN_WEEKS) continue;
    if (Math.abs(cell.r) < APART) {
      findings.push({
        kind: "declared-but-apart",
        a,
        b,
        aLabel: label.get(a) ?? a,
        bLabel: label.get(b) ?? b,
        via: belief,
        r: cell.r,
        n: cell.n,
        headline: `${label.get(a)} and ${label.get(b)} are declared under “${belief}” but have barely moved together`,
        detail: `Weekly returns correlate at ${cell.r.toFixed(2)} over ${cell.n} weeks. The shared belief may be real and simply not yet expressed in price — or the link may be a story rather than an exposure.`,
      });
    }
  }

  // 2. Two holdings moving together without a declared belief between them.
  for (const cell of matrix) {
    if (cell.n < MIN_WEEKS || declaredPairs.has(pairKey(cell.a, cell.b))) continue;
    if (proxyKeys.has(cell.a) || proxyKeys.has(cell.b)) continue;
    if (cell.r >= TOGETHER) {
      findings.push({
        kind: "correlated-but-undeclared",
        a: cell.a,
        b: cell.b,
        aLabel: label.get(cell.a) ?? cell.a,
        bLabel: label.get(cell.b) ?? cell.b,
        r: cell.r,
        n: cell.n,
        headline: `${label.get(cell.a)} and ${label.get(cell.b)} move together but share no recorded belief`,
        detail: `Weekly returns correlate at ${cell.r.toFixed(2)} over ${cell.n} weeks. Either something connects them that is not written down, or both are riding the same market factor.`,
      });
    }
  }

  // 3. A position's stated sensitivity to a macro driver that the data does not show.
  for (const p of proxies) {
    const cell = matrix.find((m) => pairKey(m.a, m.b) === pairKey(p.positionKey, p.proxyKey));
    if (!cell || cell.n < MIN_WEEKS) continue;
    if (Math.abs(cell.r) < APART) {
      findings.push({
        kind: "proxy-mismatch",
        a: p.positionKey,
        b: p.proxyKey,
        aLabel: label.get(p.positionKey) ?? p.positionKey,
        bLabel: label.get(p.proxyKey) ?? p.proxyKey,
        via: p.beliefName,
        r: cell.r,
        n: cell.n,
        headline: `${label.get(p.positionKey)} is held partly as a view on “${p.beliefName}”, which is not visible in its price`,
        detail: `Against ${label.get(p.proxyKey)}, weekly returns correlate at ${cell.r.toFixed(2)} over ${cell.n} weeks. Worth knowing before sizing the position around that exposure.`,
      });
    }
  }

  const weeksCovered = Math.max(0, ...matrix.map((m) => m.n));
  const labels: Record<string, string> = {};
  for (const k of keys) labels[k] = label.get(k) ?? k;
  return { matrix, findings, weeksCovered, excluded, labels };
}

function pairKey(a: string, b: string) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}
