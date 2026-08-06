import { getDb, newId, nowIso } from "./db";
import { symbolSeriesId } from "./correlation-report";
import { getThesisAt } from "./queries";

/**
 * Monitors turn a written claim into something that can fire.
 *
 * A thesis says "I would exit if gross margin misses for three quarters" or
 * "add below $70" or "this is a levered short on long rates". Those are prose
 * until they are bound to an observable. A monitor is that binding: a symbol, a
 * comparator, a threshold, and the assumption it speaks for.
 *
 * When one crosses, it writes ordinary ingested evidence against the assumption
 * — the same shape a human entry would take. That is deliberate: the attention
 * queue, the timeline, and the "thesis not revisited since" logic then all work
 * on it without knowing monitors exist.
 *
 * Only transitions produce records. A monitor that stays fired is quiet.
 */

export type MonitorKind =
  | "price_level"
  | "price_change"
  | "drawdown"
  | "series_level"
  | "series_change"
  | "deadline";

export type Comparator = "above" | "below";

export interface Monitor {
  id: string;
  positionId: string | null;
  assumptionId: string | null;
  beliefId: string | null;
  kind: MonitorKind;
  symbol: string;
  comparator: Comparator;
  threshold: number;
  windowDays: number | null;
  label: string;
  meaning: string | null;
  state: "clear" | "fired";
  lastValue: number | null;
  lastCheckedAt: string | null;
  firedAt: string | null;
  createdAt: string;
}

export const KIND_LABEL: Record<MonitorKind, string> = {
  price_level: "Price level",
  price_change: "Price move over a window",
  drawdown: "Drawdown from the window high",
  series_level: "Macro series level",
  series_change: "Macro series move over a window",
  deadline: "A date passing",
};

const DAY = 86_400_000;

/** Daily closes for a symbol, newest last. */
function series(symbol: string): Array<{ at: string; close: number }> {
  return getDb()
    .prepare("select occurredAt as at, price as close from marks where positionId=? order by occurredAt")
    .all(symbolSeriesId(symbol)) as Array<{ at: string; close: number }>;
}

export interface Reading {
  /** Null when there is not enough data to say anything — never guessed. */
  value: number | null;
  /** What the number means, for the record the monitor writes. */
  describe: string;
}

/** Current reading for a monitor, or null when the data cannot support one. */
export function read(m: Monitor, now = new Date()): Reading {
  if (m.kind === "deadline") {
    const days = Math.round((now.getTime() - m.threshold) / DAY);
    return {
      value: days,
      describe:
        days >= 0
          ? `the date passed ${days} day${days === 1 ? "" : "s"} ago`
          : `${-days} day${days === -1 ? "" : "s"} remaining`,
    };
  }

  const points = series(m.symbol);
  if (points.length === 0) return { value: null, describe: "no price history cached" };
  const latest = points[points.length - 1];

  if (m.kind === "price_level" || m.kind === "series_level") {
    return { value: latest.close, describe: `last close ${fmt(latest.close)}` };
  }

  const window = m.windowDays ?? 30;
  const cutoff = new Date(now.getTime() - window * DAY).toISOString();
  const inWindow = points.filter((p) => p.at >= cutoff);
  if (inWindow.length < 2) return { value: null, describe: `fewer than two closes in ${window} days` };

  if (m.kind === "drawdown") {
    const high = Math.max(...inWindow.map((p) => p.close));
    const pct = high > 0 ? ((latest.close - high) / high) * 100 : 0;
    return {
      value: pct,
      describe: `${fmt(latest.close)} against a ${window}-day high of ${fmt(high)}, ${pct.toFixed(1)}%`,
    };
  }

  // price_change / series_change
  const first = inWindow[0];
  const pct = first.close > 0 ? ((latest.close - first.close) / first.close) * 100 : 0;
  return {
    value: pct,
    describe: `${fmt(first.close)} to ${fmt(latest.close)} over ${window} days, ${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`,
  };
}

function fmt(n: number) {
  return n >= 100 ? n.toFixed(0) : n.toFixed(2);
}

function crossed(m: Monitor, value: number): boolean {
  // A deadline's threshold is a timestamp but its reading is days elapsed, so
  // comparing the two directly is meaningless. Passing the date is the condition.
  if (m.kind === "deadline") return value >= 0;
  return m.comparator === "above" ? value > m.threshold : value < m.threshold;
}

export function listMonitors(positionId?: string): Monitor[] {
  const db = getDb();
  return (
    positionId
      ? db.prepare("select * from monitors where positionId=? order by createdAt").all(positionId)
      : db.prepare("select * from monitors order by createdAt").all()
  ) as Monitor[];
}

export interface Transition {
  monitor: Monitor;
  value: number;
  describe: string;
  direction: "fired" | "cleared";
}

/**
 * Evaluates every monitor and records the ones that just changed state.
 *
 * Returns the transitions so a caller can report them; the durable record is the
 * evidence row written for each firing.
 */
export function evaluateMonitors(now = new Date()): Transition[] {
  const db = getDb();
  const transitions: Transition[] = [];
  const at = now.toISOString();

  for (const m of listMonitors()) {
    const { value, describe } = read(m, now);
    if (value === null) {
      db.prepare("update monitors set lastCheckedAt=? where id=?").run(at, m.id);
      continue;
    }
    const isFired = crossed(m, value);
    const wasFired = m.state === "fired";

    db.prepare("update monitors set lastValue=?, lastCheckedAt=? where id=?").run(value, at, m.id);
    if (isFired === wasFired) continue;

    if (isFired) {
      db.prepare("update monitors set state='fired', firedAt=? where id=?").run(at, m.id);
      transitions.push({ monitor: m, value, describe, direction: "fired" });
      recordFiring(m, describe, at);
    } else {
      // Clearing is not evidence of anything; it just re-arms the monitor.
      db.prepare("update monitors set state='clear', firedAt=null where id=?").run(m.id);
      transitions.push({ monitor: m, value, describe, direction: "cleared" });
    }
  }
  return transitions;
}

/**
 * A firing becomes an ordinary piece of evidence. Linked to the assumption when
 * the monitor names one — which is what makes the attention queue say "your
 * thesis has not been revisited since this arrived".
 */
function recordFiring(m: Monitor, describe: string, at: string) {
  if (!m.positionId) return;
  const db = getDb();

  // Only link to an assumption that still exists in the current thesis, or the
  // contradiction would point at nothing.
  const thesis = getThesisAt(m.positionId);
  const assumptionId =
    m.assumptionId && thesis?.assumptions.some((a) => a.id === m.assumptionId)
      ? m.assumptionId
      : null;

  db.prepare(
    `insert into evidence (id,positionId,occurredAt,kind,source,title,body,stance,contradictsAssumptionId,createdAt,origin,externalId)
     values (?,?,?, 'fact', ?, ?, ?, ?, ?, ?, 'ingested', ?)
     on conflict(externalId) do nothing`
  ).run(
    newId("evd"),
    m.positionId,
    at,
    `Monitor · ${m.symbol}`,
    `${m.label} — condition met`,
    `${describe}. Threshold: ${m.comparator} ${m.threshold}.` +
      (m.meaning ? ` You wrote that this would mean: ${m.meaning}` : ""),
    assumptionId ? "contradicts" : "neutral",
    assumptionId,
    at,
    // One record per firing, not per check.
    `monitor:${m.id}:${at.slice(0, 10)}`
  );
}

export function createMonitor(input: {
  positionId?: string | null;
  assumptionId?: string | null;
  beliefId?: string | null;
  kind: MonitorKind;
  symbol: string;
  comparator: Comparator;
  threshold: number;
  windowDays?: number | null;
  label: string;
  meaning?: string | null;
}): string {
  const id = newId("mon");
  getDb()
    .prepare(
      `insert into monitors (id,positionId,assumptionId,beliefId,kind,symbol,comparator,threshold,
         windowDays,label,meaning,state,lastValue,lastCheckedAt,firedAt,createdAt)
       values (?,?,?,?,?,?,?,?,?,?,?, 'clear', null, null, null, ?)`
    )
    .run(
      id,
      input.positionId ?? null,
      input.assumptionId ?? null,
      input.beliefId ?? null,
      input.kind,
      input.symbol.toUpperCase(),
      input.comparator,
      input.threshold,
      input.windowDays ?? null,
      input.label,
      input.meaning ?? null,
      nowIso()
    );
  return id;
}

export function deleteMonitor(id: string) {
  getDb().prepare("delete from monitors where id=?").run(id);
}

/** Human sentence for what a monitor is watching. */
export function describeMonitor(m: Monitor): string {
  const t = m.kind === "deadline" ? new Date(m.threshold).toISOString().slice(0, 10) : m.threshold;
  switch (m.kind) {
    case "price_level":
    case "series_level":
      return `${m.symbol} ${m.comparator} ${t}`;
    case "price_change":
    case "series_change": {
      // Reads naturally with a negative threshold: "falls more than 20%" rather
      // than "moves below -20%".
      const pct = Math.abs(Number(t));
      if (m.comparator === "below") return `${m.symbol} falls more than ${pct}% over ${m.windowDays ?? 30} days`;
      return `${m.symbol} rises more than ${pct}% over ${m.windowDays ?? 30} days`;
    }
    case "drawdown":
      return `${m.symbol} falls ${Math.abs(m.threshold)}% below its ${m.windowDays ?? 90}-day high`;
    case "deadline":
      return `${t} passes`;
  }
}
