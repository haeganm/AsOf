// Client-safe formatting. No database imports here.

const MINUS = "−"; // true minus sign, so figures line up with the percentages

export function money(n: number, opts: { cents?: boolean } = {}) {
  const digits = opts.cents ? 2 : 0;
  const abs = Math.abs(n).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  // Rounds-to-zero must not carry a sign.
  return Math.abs(n) < 0.5 / 10 ** digits || n >= 0 ? abs : `${MINUS}${abs}`;
}

/** Signs a negative but not a positive. Rounds-to-zero is unsigned. */
export function pct(n: number | null | undefined, digits = 1) {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const v = Math.abs(n);
  const rounded = v.toFixed(digits);
  const zero = Number(rounded) === 0;
  return `${n < 0 && !zero ? MINUS : ""}${rounded}%`;
}

/** Always signed, because the direction is the point. Rounds-to-zero is unsigned. */
export function signedPct(n: number | null | undefined, digits = 1) {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const v = Math.abs(n);
  const rounded = v.toFixed(digits);
  if (Number(rounded) === 0) return `${rounded}%`;
  return `${n < 0 ? MINUS : "+"}${rounded}%`;
}

export function shortDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function monthYear(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

const DAY = 86_400_000;

const MONTH = 30.44 * DAY; // mean calendar month; 30 drifts ~1.4%

export function daysUntil(iso: string) {
  return Math.round((new Date(iso).getTime() - Date.now()) / DAY);
}

/** "14 days ago" / "in 12 days" — relative to now, or to a supplied reference. */
export function relativeDays(iso: string, ref: string = new Date().toISOString()) {
  const ms = new Date(ref).getTime() - new Date(iso).getTime();
  const days = Math.round(ms / DAY);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days === -1) return "tomorrow";
  const span = describeSpan(Math.abs(ms));
  return days > 0 ? `${span} ago` : `in ${span}`;
}

/**
 * Days, then months, then years. The day cutoff is 31 rather than something
 * larger so that "1 month" is actually reachable — round(45 / 30.44) is already
 * 1, so a 45-day cutoff left the single-month bucket empty.
 */
export function describeSpan(ms: number) {
  const days = Math.round(ms / DAY);
  if (days <= 31) return `${days} day${days === 1 ? "" : "s"}`;
  const months = Math.round(ms / MONTH);
  if (months < 18) return `${months} month${months === 1 ? "" : "s"}`;
  const years = Math.round((ms / (365.25 * DAY)) * 10) / 10;
  return `${years} year${years === 1 ? "" : "s"}`;
}

export const VERDICT_LABEL: Record<string, string> = {
  yes: "Yes",
  partly: "Partly",
  no: "No",
  worked: "Worked",
  mixed: "Mixed",
  did_not_work: "Did not work",
  skill: "Skill",
  luck: "Luck",
  external: "Outside event",
};
