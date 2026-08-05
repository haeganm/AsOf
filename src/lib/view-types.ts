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
  shares: number;
  /** Latest mark at or before the as-of bound. Null if the position had no mark yet. */
  price: number | null;
  value: number;
  costBasis: number;
  returnPct: number | null;
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
  /** Everything at or before this instant is fair game; everything after is sealed. */
  asOf: string;
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
