import type { Assumption } from "./types";

/**
 * Ids for newly added assumptions.
 *
 * Lives in its own module so it can be unit-tested: `actions.ts` is a
 * `"use server"` file and may only export async functions.
 *
 * The rule is "continue past the highest number ever used", not "continue past
 * the count". Numbering from the count re-mints an id as soon as one assumption
 * has been dropped, and a re-minted id silently re-points every piece of
 * evidence recorded against the original — the contradiction stays on the
 * position but now argues with a different claim.
 */
export function nextAssumptionIds(existing: Assumption[], count: number): string[] {
  const used = new Set(existing.map((a) => a.id));
  let n = existing.reduce((max, a) => {
    const parsed = Number(/^a(\d+)$/.exec(a.id)?.[1] ?? 0);
    return Number.isFinite(parsed) && parsed > max ? parsed : max;
  }, 0);

  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    do {
      n += 1;
    } while (used.has(`a${n}`));
    used.add(`a${n}`);
    out.push(`a${n}`);
  }
  return out;
}
