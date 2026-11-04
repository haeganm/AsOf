/**
 * Grading: what happened after a signal, measured honestly.
 *
 * Pure maths over price series — no database, no network — so every rule here
 * is testable against synthetic bars. The rules exist to close specific
 * lookahead holes:
 *
 * 1. Entry is defined in SESSION terms, not raw timestamps. Daily marks are
 *    date-labelled while `knownAt` is a datetime; comparing them raw would let
 *    a filing accepted pre-open "buy" the previous close, or deny it that same
 *    day's close which a human could genuinely have traded. The rule: you enter
 *    at the close of the first trading day whose session end (4:00 pm America/
 *    New_York, DST-aware) falls after `knownAt`.
 *
 * 2. Horizons are counted on the BENCHMARK's calendar. Both legs share the same
 *    two endpoint dates — the entry date, and the date N benchmark trading days
 *    later — so a halted day on one leg cannot desynchronise the comparison.
 *
 * 3. Nothing is graded early, nothing older than the price history is graded
 *    at all, and a dead series is not silently dropped. A
 *    horizon that has not fully elapsed is `pending`; a symbol whose series
 *    ends well before the exit date (delisting, acquisition) is `ungraded` and
 *    is COUNTED as such wherever grades are shown.
 */

export interface DailyBar {
  /** ISO timestamp as stored in marks; only its UTC date part identifies the trading day. */
  at: string;
  close: number;
}

export const HORIZONS = [5, 20, 60] as const;
export type Horizon = (typeof HORIZONS)[number];

/** How far a series may end before the exit date and still count as a real exit print. */
const STALE_EXIT_DAYS = 7;

export type GradeResult =
  | { status: "graded"; entryAt: string; exitAt: string; signalReturn: number; benchmarkReturn: number; excessReturn: number }
  | { status: "pending" } // horizon not fully elapsed yet
  | { status: "ungraded"; reason: string }; // can never be graded (series died, no entry print)

/** The trading date (YYYY-MM-DD) a mark belongs to. Yahoo daily bars are stamped at market open UTC, so the UTC date is the trading date. */
export function tradingDate(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * Collapse a series to one bar per calendar date, keeping the latest-stamped.
 * Legacy weekly bars are stamped at 04:00 on the week's FIRST day but carry the
 * week's LAST close — beside a daily bar for the same date, the early stamp
 * wins any ordered scan and hands the grader a close from four days in the
 * future. Verified live: CEG 2024-09-16 carried Friday's post-news 254.98
 * against Monday's real 199.25. Every series read goes through this.
 */
export function lastPerDay(bars: DailyBar[]): DailyBar[] {
  const byDay = new Map<string, DailyBar>();
  for (const b of bars) byDay.set(tradingDate(b.at), b); // input is sorted; later stamp wins
  return [...byDay.values()];
}

/**
 * 4:00 pm America/New_York on the given date, as a UTC ISO instant. DST-aware
 * without a timezone library: format a UTC guess back into New York time and
 * correct by the difference.
 */
export function sessionEndUtc(date: string): string {
  // Guess 21:00 UTC (right in winter, one hour late in summer), then correct.
  const guess = new Date(`${date}T21:00:00.000Z`);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    hour12: false,
  }).formatToParts(guess);
  const nyHour = Number(parts.find((p) => p.type === "hour")?.value ?? 16);
  const corrected = new Date(guess.getTime() - (nyHour - 16) * 3_600_000);
  return corrected.toISOString();
}

/** First bar a human could have traded the close of after learning the fact at `knownAt`. */
export function entryBar(bars: DailyBar[], knownAt: string): DailyBar | null {
  // Numeric comparison: a knownAt without milliseconds would sort after the
  // session end lexicographically even when the instants are equal.
  const known = Date.parse(knownAt);
  for (const b of bars) {
    if (Date.parse(sessionEndUtc(tradingDate(b.at))) > known) return b;
  }
  return null;
}

/**
 * Grade one signal at one horizon.
 *
 * `symbolBars` and `benchmarkBars` must be daily closes sorted ascending.
 */
export function grade(
  symbolBars: DailyBar[],
  benchmarkBars: DailyBar[],
  knownAt: string,
  horizonDays: number
): GradeResult {
  if (symbolBars.length === 0) return { status: "ungraded", reason: "no price history for the symbol" };
  if (benchmarkBars.length === 0) return { status: "pending" };

  const entry = entryBar(symbolBars, knownAt);
  if (!entry) {
    // No symbol print after knownAt. If the benchmark has moved on for a while,
    // the series is dead and this will never grade; otherwise it is just new.
    const lastBench = tradingDate(benchmarkBars[benchmarkBars.length - 1].at);
    const lastSym = tradingDate(symbolBars[symbolBars.length - 1].at);
    return daysBetween(lastSym, lastBench) > STALE_EXIT_DAYS
      ? { status: "ungraded", reason: "the symbol stopped trading before the signal could be entered" }
      : { status: "pending" };
  }

  const entryDate = tradingDate(entry.at);

  // A signal older than the price history has no real entry: entryBar would
  // hand back the series' first bar, years after the fact. Weekends and
  // holidays stay inside the stale limit, so a signal from just before the
  // history starts still enters at its first close.
  if (daysBetween(tradingDate(knownAt), entryDate) > STALE_EXIT_DAYS) {
    return { status: "ungraded", reason: `the signal predates the price history, which starts ${entryDate}` };
  }

  // Benchmark leg anchors at its first bar on or after the entry date; the exit
  // date is N benchmark trading days later — the shared calendar for both legs.
  const benchEntryIdx = benchmarkBars.findIndex((b) => tradingDate(b.at) >= entryDate);
  if (benchEntryIdx === -1) return { status: "pending" };
  const benchExitIdx = benchEntryIdx + horizonDays;
  if (benchExitIdx >= benchmarkBars.length) return { status: "pending" };

  const benchEntry = benchmarkBars[benchEntryIdx];
  const benchExit = benchmarkBars[benchExitIdx];
  const exitDate = tradingDate(benchExit.at);

  // Symbol leg exits at its last print on or before the shared exit date.
  let symExit: DailyBar | null = null;
  for (const b of symbolBars) {
    const d = tradingDate(b.at);
    if (d > exitDate) break;
    if (d >= entryDate) symExit = b;
  }
  if (!symExit) return { status: "ungraded", reason: "no symbol print between entry and exit" };
  if (daysBetween(tradingDate(symExit.at), exitDate) > STALE_EXIT_DAYS) {
    return { status: "ungraded", reason: `the symbol's series ends ${tradingDate(symExit.at)}, well before the ${exitDate} exit` };
  }

  const signalReturn = symExit.close / entry.close - 1;
  const benchmarkReturn = benchExit.close / benchEntry.close - 1;
  return {
    status: "graded",
    entryAt: entry.at,
    exitAt: symExit.at,
    signalReturn,
    benchmarkReturn,
    excessReturn: signalReturn - benchmarkReturn,
  };
}

/** A directional signal "hit" when its excess return agreed with its direction. Info signals have no hit. */
export function isHit(direction: string, excessReturn: number): boolean | null {
  if (direction === "long") return excessReturn > 0;
  if (direction === "short") return excessReturn < 0;
  return null;
}

function daysBetween(fromDate: string, toDate: string): number {
  return Math.round((Date.parse(toDate) - Date.parse(fromDate)) / 86_400_000);
}
