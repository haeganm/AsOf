// Domain types. Every record carries a domain timestamp (`occurredAt`) separate
// from when the row was written — that separation is what makes Replay honest.

export type PositionStatus = "open" | "closed" | "watching" | "passed";

export type DecisionType =
  | "open"
  | "add"
  | "reduce"
  | "hold"
  | "hedge"
  | "exit"
  | "pass"
  | "thesis_change";

export const DECISION_TYPES: DecisionType[] = [
  "open",
  "add",
  "reduce",
  "hold",
  "hedge",
  "exit",
  "pass",
  "thesis_change",
];

export const DECISION_LABEL: Record<DecisionType, string> = {
  open: "Open",
  add: "Add",
  reduce: "Reduce",
  hold: "Hold",
  hedge: "Hedge",
  exit: "Exit",
  pass: "Pass",
  thesis_change: "Thesis change",
};

export type AssumptionStatus = "intact" | "weakening" | "broken";
export type Sensitivity = "high" | "medium" | "low";
export type EvidenceKind = "fact" | "interpretation";
export type EvidenceStance = "supports" | "contradicts" | "neutral";
export type OutcomeVerdict = "worked" | "mixed" | "did_not_work";
export type VerdictValue = "yes" | "partly" | "no";

export interface Assumption {
  id: string;
  text: string;
  status: AssumptionStatus;
}

export interface Scenario {
  name: string;
  probability: number;
  expectedReaction: string;
  plannedAction: string;
}

export interface EventOutcome {
  whatHappened: string;
  actualReaction: string;
  forecastAccurate: VerdictValue;
  rightVariables: VerdictValue;
  followedPlan: VerdictValue;
  reactionSurprising: VerdictValue;
  notes?: string;
}

export interface Verdicts {
  thesisCorrect: VerdictValue;
  thesisNote?: string;
  valuationRight: VerdictValue;
  valuationNote?: string;
  sizingRight: VerdictValue;
  sizingNote?: string;
  timingRight: VerdictValue;
  timingNote?: string;
  followedProcess: VerdictValue;
  processNote?: string;
  drivenBy: "skill" | "luck" | "external";
  drivenByNote?: string;
}

export interface Portfolio {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
}

export interface Position {
  id: string;
  portfolioId: string;
  ticker: string;
  name: string;
  assetClass: string | null;
  status: PositionStatus;
  openedAt: string | null;
  closedAt: string | null;
  createdAt: string;
}

export interface Lot {
  id: string;
  positionId: string;
  occurredAt: string;
  deltaShares: number;
  price: number;
  note: string | null;
}

export interface Mark {
  id: string;
  positionId: string;
  occurredAt: string;
  price: number;
}

export interface Thesis {
  id: string;
  positionId: string;
  versionNo: number;
  occurredAt: string;
  summary: string;
  marketView: string | null;
  variantView: string | null;
  assumptions: Assumption[];
  catalysts: string[];
  risks: string[];
  falsifiers: string[];
  horizon: string | null;
  addCondition: string | null;
  trimCondition: string | null;
  exitCondition: string | null;
  confidence: number;
  changeNote: string | null;
  createdAt: string;
}

export interface Decision {
  id: string;
  portfolioId: string;
  positionId: string | null;
  occurredAt: string;
  type: DecisionType;
  what: string;
  why: string;
  expectation: string | null;
  confidence: number;
  mainRisk: string | null;
  reversalTrigger: string | null;
  linkedEventId: string | null;
  outcomeAt: string | null;
  outcomeNote: string | null;
  outcomeVerdict: OutcomeVerdict | null;
  createdAt: string;
}

export interface Evidence {
  id: string;
  positionId: string;
  occurredAt: string;
  kind: EvidenceKind;
  source: string | null;
  title: string;
  body: string | null;
  stance: EvidenceStance;
  contradictsAssumptionId: string | null;
  createdAt: string;
}

export interface CatalystEvent {
  id: string;
  portfolioId: string;
  positionId: string | null;
  title: string;
  kind: string | null;
  /** When the event happens. */
  occurredAt: string;
  /** When the user first knew about / prepared for it — this is what asOf filters on. */
  knownAt: string;
  status: "upcoming" | "resolved";
  marketExpects: string | null;
  iExpect: string | null;
  keyVariables: string[];
  scenarios: Scenario[];
  outcome: EventOutcome | null;
  resolvedAt: string | null;
  createdAt: string;
}

export interface Belief {
  id: string;
  name: string;
  description: string | null;
  stance: string | null;
  confidence: number | null;
  createdAt: string;
}

export interface PositionBelief {
  id: string;
  positionId: string;
  beliefId: string;
  relationship: string | null;
  sensitivity: Sensitivity;
  /** When you connected this position to this belief. Bounds as-of views. */
  occurredAt: string;
}

export interface Postmortem {
  id: string;
  positionId: string;
  decisionId: string | null;
  occurredAt: string;
  verdicts: Verdicts;
  lesson: string | null;
  processChange: string | null;
  createdAt: string;
}

export interface ReplayAttempt {
  id: string;
  decisionId: string;
  createdAt: string;
  newChoice: DecisionType;
  newReasoning: string | null;
  newConfidence: number;
  hindsightNote: string | null;
}
