/**
 * Honest statistics for a very small sample.
 *
 * The calibration page previously reported bucket rates as bare percentages, so
 * a bucket of one decision at 100% looked like the strongest signal on the page.
 * Two things fix that: an interval that widens as the sample shrinks, and a
 * proper scoring rule for the forecasts the app was already collecting and
 * discarding.
 *
 * Pure functions, no database — so they can be tested against fixtures.
 */

export interface Interval {
  low: number;
  high: number;
  /** Half-width, for a compact "62% ± 18" rendering. */
  spread: number;
}

/**
 * Wilson score interval for a proportion.
 *
 * Preferred over the textbook normal approximation because that one produces
 * nonsense at the edges — a bucket where everything worked gets an interval of
 * exactly [100%, 100%], which is precisely the false confidence worth avoiding.
 * Wilson stays inside 0..1 and stays wide when n is small.
 */
export function wilson(successes: number, n: number, z = 1.96): Interval {
  if (n <= 0) return { low: 0, high: 100, spread: 50 };
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const margin = (z / denom) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  const low = Math.max(0, (centre - margin) * 100);
  const high = Math.min(100, (centre + margin) * 100);
  return { low, high, spread: (high - low) / 2 };
}

/**
 * Brier score for a single multi-outcome forecast.
 *
 * The user writes probabilities across bull/base/bear and exactly one happens.
 * That is a scorable forecast, and until now it was thrown away. Lower is
 * better: 0 is perfect, and the score is the mean squared error across all
 * declared outcomes rather than only the one that landed — which is what stops
 * hedging everything at equal probability from looking good.
 */
export function brierScore(
  probabilities: Record<string, number>,
  actual: string
): number | null {
  const names = Object.keys(probabilities);
  if (names.length === 0 || !names.includes(actual)) return null;
  const total = names.reduce((s, k) => s + probabilities[k], 0);
  if (total <= 0) return null;

  let sum = 0;
  for (const name of names) {
    const p = probabilities[name] / total; // tolerate 0..100 or 0..1
    const outcome = name === actual ? 1 : 0;
    sum += (p - outcome) ** 2;
  }
  return sum / names.length;
}

/**
 * What a Brier score would be if you had simply spread probability evenly.
 *
 * A score means nothing on its own; it means something against the score you
 * would have got for knowing nothing.
 */
export function uninformedBrier(outcomes: number): number {
  if (outcomes <= 0) return 0;
  const p = 1 / outcomes;
  return ((p - 1) ** 2 + (outcomes - 1) * p ** 2) / outcomes;
}

export interface BrierSummary {
  scored: number;
  mean: number;
  baseline: number;
  /** Positive means better than knowing nothing. */
  skill: number;
}

export function summariseBrier(scores: Array<{ score: number; outcomes: number }>): BrierSummary | null {
  if (scores.length === 0) return null;
  const mean = scores.reduce((s, x) => s + x.score, 0) / scores.length;
  const baseline =
    scores.reduce((s, x) => s + uninformedBrier(x.outcomes), 0) / scores.length;
  return {
    scored: scores.length,
    mean,
    baseline,
    // Skill score: the conventional 1 - (score / reference).
    skill: baseline > 0 ? 1 - mean / baseline : 0,
  };
}

/**
 * Smallest sample that can distinguish anything.
 *
 * Below this a rate is quoted with its interval but never described in words —
 * "you are overconfident" from four decisions is a sentence the data cannot pay
 * for.
 */
export const MIN_FOR_CLAIM = 8;

/** Do two proportions differ by more than their intervals allow? */
export function separated(a: Interval, b: Interval): boolean {
  return a.low > b.high || b.low > a.high;
}
