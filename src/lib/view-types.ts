// Derived shapes the UI consumes. Re-exports the domain types so pages have one
// import site.
export * from "./types";

import type {
  Belief,
  CatalystEvent,
  Decision,
  Evidence,
  Lot,
  Position,
  PositionBelief,
  Postmortem,
  ReplayAttempt,
  Thesis,
} from "./types";

export interface PositionSnapshot extends Position {
  /**
   * Status *as of the bound*, not the stored value — rewinding un-closes a
   * position that had not been sold yet, and a watched idea is not "closed".
   */
  status: Position["status"];
  /** The raw stored status, for the rare case a page needs it. */
  declaredStatus: Position["status"];
  shares: number;
  /** Latest mark at or before the as-of bound. Null if the position had no mark yet. */
  price: number | null;
  value: number;
  /** Average cost of the *current* holding; 0 once flat. */
  costBasis: number;
  /** Unrealised return on the current holding. Null when flat. */
  returnPct: number | null;
  realisedPnl: number;
  /** Realised return on the cost of the shares sold. Null if nothing has been sold. */
  realisedPct: number | null;
  unrealisedPnl: number;
  totalPnl: number;
  /** Price and date of the sale that closed the position. Null while still held. */
  exitPrice: number | null;
  exitAt: string | null;
  weightPct: number;
  thesis: Thesis | null;
  lastActivityAt: string | null;
}

export type TimelineEntry =
  | { at: string; kind: "evidence"; data: Evidence }
  | { at: string; kind: "decision"; data: Decision }
  | { at: string; kind: "thesis"; data: Thesis }
  | { at: string; kind: "lot"; data: Lot }
  | { at: string; kind: "event"; data: CatalystEvent; phase: "prepared" | "resolved" }
  | { at: string; kind: "postmortem"; data: Postmortem };

export interface AttentionItem {
  id: string;
  severity: "high" | "medium" | "low";
  /** Short label for the kind of tension, e.g. "Unreviewed contradiction". */
  kind: string;
  headline: string;
  detail: string;
  /** The product never rules on the thesis — it ends on a question. */
  question: string;
  href: string;
  positionId?: string;
}

export interface BeliefExposure {
  belief: Belief;
  links: Array<PositionBelief & { position: PositionSnapshot }>;
  heldCount: number;
  value: number;
  weightPct: number;
  highSensitivityWeightPct: number;
  events: CatalystEvent[];
}

export interface CalibrationBucket {
  confidence: number;
  count: number;
  worked: number;
  mixed: number;
  failed: number;
  realisedPct: number;
  /** Wilson interval, so a bucket of one is visibly uninformative. */
  interval: { low: number; high: number; spread: number };
  decisions: Decision[];
}

export interface Pattern {
  id: string;
  title: string;
  finding: string;
  soWhat: string;
  evidence: Decision[];
  events?: CatalystEvent[];
}

export interface ReplayContext {
  decision: Decision;
  /** The user's own act is sealed from here (1 ms before the decision). */
  asOf: string;
  /** Market facts were knowable up to and including the decision instant. */
  marketAsOf: string;
  position: PositionSnapshot | null;
  positionsThen: PositionSnapshot[];
  thesisThen: Thesis | null;
  evidenceThen: Evidence[];
  upcomingThen: CatalystEvent[];
  beliefsThen: Array<PositionBelief & { belief: Belief }>;
  priceThen: number | null;
  priceNow: number | null;
  priceChangePct: number | null;
  marksAfter: Array<{ occurredAt: string; price: number }>;
  timelineAfter: TimelineEntry[];
  attempts: ReplayAttempt[];
  postmortem: Postmortem | null;
}
