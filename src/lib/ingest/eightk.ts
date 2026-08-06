import { recordSignal } from "../signals";
import type { Filing } from "./filings";

/**
 * 8-K filings as event-class signals, one per (filing, allowlisted item).
 *
 * The allowlist is a decision, not a vibe. Items 7.01 (Reg FD), 8.01 (other)
 * and 9.01 (exhibits) ride on nearly every filing and would drown the feed, so
 * they are excluded. What remains is the set where "what usually happens next"
 * is a question worth asking.
 *
 * No watermark: signals dedupe on externalId, so re-scanning the same
 * submissions window every day is a no-op. Historical filings are wanted here —
 * they are what gives a study its sample size — and arrive flagged backfilled,
 * which keeps them off the live scorecard while the studies use them.
 */

export const EIGHTK_ITEMS: Record<string, string> = {
  "1.01": "Material agreement",
  "1.03": "Bankruptcy",
  "2.01": "Acquisition or disposition completed",
  "2.02": "Results announced",
  "3.01": "Listing deficiency",
  "4.01": "Auditor change",
  "4.02": "Financials no longer reliable",
  "5.02": "Leadership change",
};

export function emitEightK(symbol: string, filings: Filing[]): number {
  let emitted = 0;
  for (const f of filings) {
    if (f.form !== "8-K") continue;
    for (const item of f.items) {
      const label = EIGHTK_ITEMS[item];
      if (!label) continue;
      const id = recordSignal({
        source: "filing",
        kind: `8k_${item}`,
        symbol,
        direction: "info",
        firedAt: f.filedAt,
        knownAt: f.acceptedAt,
        title: `${symbol}: ${label} (8-K item ${item})`,
        detail: f.description ? `Primary document: ${f.description}.` : null,
        externalId: `sig:8k:${f.accession}:${item}`,
      });
      if (id) emitted++;
    }
  }
  return emitted;
}
