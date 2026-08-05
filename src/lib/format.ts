// Client-safe formatting. No database imports here.

export function money(n: number, opts: { cents?: boolean } = {}) {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: opts.cents ? 2 : 0,
    maximumFractionDigits: opts.cents ? 2 : 0,
  });
}

export function pct(n: number | null | undefined, digits = 1) {
  if (n === null || n === undefined) return "—";
  return `${n >= 0 ? "" : "−"}${Math.abs(n).toFixed(digits)}%`;
}

export function signedPct(n: number | null | undefined, digits = 1) {
  if (n === null || n === undefined) return "—";
  return `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(digits)}%`;
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

/** "14 days ago" / "in 12 days" — relative to now, or to a supplied reference. */
export function relativeDays(iso: string, ref: string = new Date().toISOString()) {
  const diff = Math.round((new Date(ref).getTime() - new Date(iso).getTime()) / DAY);
  if (diff === 0) return "today";
  if (diff === 1) return "yesterday";
  if (diff === -1) return "tomorrow";
  if (diff > 0) return diff < 60 ? `${diff} days ago` : `${Math.round(diff / 30)} months ago`;
  const ahead = -diff;
  return ahead < 60 ? `in ${ahead} days` : `in ${Math.round(ahead / 30)} months`;
}

export function daysUntil(iso: string) {
  return Math.round((new Date(iso).getTime() - Date.now()) / DAY);
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
