"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb, newId, nowIso } from "./db";
import { getThesisAt } from "./queries";
import type { Assumption, DecisionType } from "./types";
import { DECISION_TYPES } from "./types";

/*
  All writes. Two rules hold everywhere:
   1. Nothing is ever updated in place if it represents a past belief — thesis
      versions are inserted, never edited.
   2. Inputs are validated here, not only in the browser, because the browser is
      not a trust boundary even on localhost.
*/

const VERDICTS = ["yes", "partly", "no"] as const;

function str(fd: FormData, key: string, opts: { required?: boolean; max?: number } = {}): string {
  const raw = fd.get(key);
  const v = typeof raw === "string" ? raw.trim() : "";
  if (opts.required && v.length === 0) throw new Error(`“${key}” is required.`);
  return v.slice(0, opts.max ?? 8000);
}

function lines(fd: FormData, key: string): string[] {
  return str(fd, key)
    .split("\n")
    .map((s) => s.replace(/^[-–—•*]\s*/, "").trim())
    .filter(Boolean);
}

function int(fd: FormData, key: string, min: number, max: number, fallback?: number): number {
  const n = Number(str(fd, key));
  if (!Number.isFinite(n)) {
    if (fallback !== undefined) return fallback;
    throw new Error(`“${key}” must be a number.`);
  }
  return Math.min(max, Math.max(min, Math.round(n)));
}

function float(fd: FormData, key: string, opts: { required?: boolean } = {}): number {
  const raw = str(fd, key);
  if (!raw && !opts.required) return 0;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`“${key}” must be a number.`);
  return n;
}

function pick<T extends string>(fd: FormData, key: string, allowed: readonly T[], fallback: T): T {
  const v = str(fd, key) as T;
  return allowed.includes(v) ? v : fallback;
}

/** Dates are entered as `yyyy-mm-dd`; anything unparseable falls back to now. */
function dateOr(fd: FormData, key: string, fallback = nowIso()): string {
  const v = str(fd, key);
  if (!v) return fallback;
  const d = new Date(`${v}T12:00:00`);
  return Number.isNaN(d.getTime()) ? fallback : d.toISOString();
}

function assumptionsFrom(fd: FormData, existing: Assumption[]): Assumption[] {
  const out: Assumption[] = [];
  // Carried-forward assumptions keep their id, so evidence linked to them stays linked.
  for (const a of existing) {
    const text = str(fd, `asm_text_${a.id}`) || a.text;
    if (str(fd, `asm_drop_${a.id}`) === "on") continue;
    out.push({
      id: a.id,
      text,
      status: pick(fd, `asm_status_${a.id}`, ["intact", "weakening", "broken"] as const, a.status),
    });
  }
  let next = existing.length;
  for (const text of lines(fd, "assumptions_new")) {
    next += 1;
    out.push({ id: `a${next}`, text, status: "intact" });
  }
  return out;
}

function refresh(...paths: string[]) {
  revalidatePath("/", "layout");
  for (const p of paths) revalidatePath(p);
}

// ── positions & theses ────────────────────────────────────────────────────

export async function createPosition(fd: FormData) {
  const db = getDb();
  const portfolio = db.prepare("select id from portfolios limit 1").get() as { id: string };
  const ticker = str(fd, "ticker", { required: true, max: 12 }).toUpperCase();
  const name = str(fd, "name", { required: true, max: 120 }) || ticker;
  const kind = pick(fd, "kind", ["open", "watching", "passed"] as const, "open");
  const at = dateOr(fd, "occurredAt");
  const positionId = newId("pos");
  const shares = float(fd, "shares");
  const price = float(fd, "price");

  db.prepare(
    `insert into positions (id,portfolioId,ticker,name,assetClass,status,openedAt,closedAt,createdAt)
     values (?,?,?,?,?,?,?,null,?)`
  ).run(
    positionId,
    portfolio.id,
    ticker,
    name,
    str(fd, "assetClass", { max: 80 }) || null,
    kind,
    kind === "open" ? at : null,
    at
  );

  if (kind === "open" && shares > 0 && price > 0) {
    db.prepare(
      "insert into lots (id,positionId,occurredAt,deltaShares,price,note) values (?,?,?,?,?,?)"
    ).run(newId("lot"), positionId, at, shares, price, "Initial position.");
  }
  if (price > 0) {
    db.prepare("insert into marks (id,positionId,occurredAt,price) values (?,?,?,?)").run(
      newId("mk"),
      positionId,
      at,
      price
    );
  }

  const assumptions = assumptionsFrom(fd, []);
  db.prepare(
    `insert into thesis_versions
     (id,positionId,versionNo,occurredAt,summary,marketView,variantView,assumptions,catalysts,risks,
      falsifiers,horizon,addCondition,trimCondition,exitCondition,confidence,changeNote,createdAt)
     values (?,?,1,?,?,?,?,?,?,?,?,?,?,?,?,?,null,?)`
  ).run(
    newId("th"),
    positionId,
    at,
    str(fd, "summary", { required: true }),
    str(fd, "marketView") || null,
    str(fd, "variantView") || null,
    JSON.stringify(assumptions),
    JSON.stringify(lines(fd, "catalysts")),
    JSON.stringify(lines(fd, "risks")),
    JSON.stringify(lines(fd, "falsifiers")),
    str(fd, "horizon", { max: 80 }) || null,
    str(fd, "addCondition") || null,
    str(fd, "trimCondition") || null,
    str(fd, "exitCondition") || null,
    int(fd, "confidence", 1, 5, 3),
    at
  );

  // The act of opening (or declining) is itself a decision worth keeping.
  const why = str(fd, "why") || str(fd, "variantView") || str(fd, "summary", { required: true });
  db.prepare(
    `insert into decisions (id,portfolioId,positionId,occurredAt,type,what,why,expectation,confidence,
       mainRisk,reversalTrigger,linkedEventId,outcomeAt,outcomeNote,outcomeVerdict,createdAt)
     values (?,?,?,?,?,?,?,?,?,?,?,null,null,null,null,?)`
  ).run(
    newId("dec"),
    portfolio.id,
    positionId,
    at,
    kind === "passed" ? "pass" : "open",
    kind === "passed"
      ? `Pass on ${ticker}.`
      : shares > 0
        ? `Open ${ticker} — ${shares.toLocaleString()} shares at ${price}.`
        : `Open ${ticker}.`,
    why,
    str(fd, "expectation") || null,
    int(fd, "confidence", 1, 5, 3),
    lines(fd, "risks")[0] ?? null,
    lines(fd, "falsifiers")[0] ?? null,
    at
  );

  for (const beliefId of fd.getAll("beliefIds").map(String).filter(Boolean)) {
    db.prepare(
      "insert into position_beliefs (id,positionId,beliefId,relationship,sensitivity) values (?,?,?,?,?)"
    ).run(newId("pb"), positionId, beliefId, null, "high");
  }

  refresh();
  redirect(`/positions/${positionId}`);
}

/** Never mutates the prior version — a new row is the only way to change a view. */
export async function updateThesis(fd: FormData) {
  const db = getDb();
  const positionId = str(fd, "positionId", { required: true });
  const current = getThesisAt(positionId);
  if (!current) throw new Error("No existing thesis to update.");
  const at = nowIso();

  db.prepare(
    `insert into thesis_versions
     (id,positionId,versionNo,occurredAt,summary,marketView,variantView,assumptions,catalysts,risks,
      falsifiers,horizon,addCondition,trimCondition,exitCondition,confidence,changeNote,createdAt)
     values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    newId("th"),
    positionId,
    current.versionNo + 1,
    at,
    str(fd, "summary", { required: true }),
    str(fd, "marketView") || null,
    str(fd, "variantView") || null,
    JSON.stringify(assumptionsFrom(fd, current.assumptions)),
    JSON.stringify(lines(fd, "catalysts")),
    JSON.stringify(lines(fd, "risks")),
    JSON.stringify(lines(fd, "falsifiers")),
    str(fd, "horizon", { max: 80 }) || null,
    str(fd, "addCondition") || null,
    str(fd, "trimCondition") || null,
    str(fd, "exitCondition") || null,
    int(fd, "confidence", 1, 5, current.confidence),
    str(fd, "changeNote", { required: true }),
    at
  );

  const portfolio = db.prepare("select id from portfolios limit 1").get() as { id: string };
  db.prepare(
    `insert into decisions (id,portfolioId,positionId,occurredAt,type,what,why,expectation,confidence,
       mainRisk,reversalTrigger,linkedEventId,outcomeAt,outcomeNote,outcomeVerdict,createdAt)
     values (?,?,?,?, 'thesis_change', ?,?,null,?,null,null,null,null,null,null,?)`
  ).run(
    newId("dec"),
    portfolio.id,
    positionId,
    at,
    `Thesis updated to v${current.versionNo + 1}.`,
    str(fd, "changeNote", { required: true }),
    int(fd, "confidence", 1, 5, current.confidence),
    at
  );

  refresh(`/positions/${positionId}`);
  redirect(`/positions/${positionId}`);
}

// ── decisions ─────────────────────────────────────────────────────────────

export async function recordDecision(fd: FormData) {
  const db = getDb();
  const portfolio = db.prepare("select id from portfolios limit 1").get() as { id: string };
  const positionId = str(fd, "positionId") || null;
  const type = pick(fd, "type", DECISION_TYPES as readonly DecisionType[], "hold");
  const at = dateOr(fd, "occurredAt");
  const id = newId("dec");

  db.prepare(
    `insert into decisions (id,portfolioId,positionId,occurredAt,type,what,why,expectation,confidence,
       mainRisk,reversalTrigger,linkedEventId,outcomeAt,outcomeNote,outcomeVerdict,createdAt)
     values (?,?,?,?,?,?,?,?,?,?,?,?,null,null,null,?)`
  ).run(
    id,
    portfolio.id,
    positionId,
    at,
    type,
    str(fd, "what", { required: true }),
    str(fd, "why", { required: true }),
    str(fd, "expectation") || null,
    int(fd, "confidence", 1, 5, 3),
    str(fd, "mainRisk") || null,
    str(fd, "reversalTrigger") || null,
    str(fd, "linkedEventId") || null,
    at
  );

  // A decision that changes size should move the size.
  const shares = float(fd, "shares");
  const price = float(fd, "price");
  if (positionId && shares > 0 && price > 0 && ["open", "add", "reduce", "exit"].includes(type)) {
    const signed = type === "reduce" || type === "exit" ? -Math.abs(shares) : Math.abs(shares);
    db.prepare(
      "insert into lots (id,positionId,occurredAt,deltaShares,price,note) values (?,?,?,?,?,?)"
    ).run(newId("lot"), positionId, at, signed, price, str(fd, "what", { required: true }));
    db.prepare("insert into marks (id,positionId,occurredAt,price) values (?,?,?,?)").run(
      newId("mk"),
      positionId,
      at,
      price
    );
    const held = db
      .prepare("select coalesce(sum(deltaShares),0) as s from lots where positionId=?")
      .get(positionId) as { s: number };
    if (held.s <= 0.0001) {
      db.prepare("update positions set status='closed', closedAt=? where id=?").run(at, positionId);
    }
  }

  refresh(positionId ? `/positions/${positionId}` : "/decisions");
  redirect(`/decisions/${id}`);
}

/** Closes the loop on a past decision. This is what makes the pattern engine work. */
export async function recordDecisionOutcome(fd: FormData) {
  const id = str(fd, "decisionId", { required: true });
  getDb()
    .prepare("update decisions set outcomeAt=?, outcomeNote=?, outcomeVerdict=? where id=?")
    .run(
      nowIso(),
      str(fd, "outcomeNote", { required: true }),
      pick(fd, "outcomeVerdict", ["worked", "mixed", "did_not_work"] as const, "mixed"),
      id
    );
  refresh("/patterns", `/decisions/${id}`);
  redirect(`/decisions/${id}`);
}

// ── evidence ──────────────────────────────────────────────────────────────

export async function addEvidence(fd: FormData) {
  const positionId = str(fd, "positionId", { required: true });
  const contradicts = str(fd, "contradictsAssumptionId");
  getDb()
    .prepare(
      `insert into evidence (id,positionId,occurredAt,kind,source,title,body,stance,contradictsAssumptionId,createdAt)
       values (?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      newId("evd"),
      positionId,
      dateOr(fd, "occurredAt"),
      pick(fd, "kind", ["fact", "interpretation"] as const, "fact"),
      str(fd, "source", { max: 160 }) || null,
      str(fd, "title", { required: true, max: 240 }),
      str(fd, "body") || null,
      contradicts ? "contradicts" : pick(fd, "stance", ["supports", "neutral"] as const, "neutral"),
      contradicts || null,
      nowIso()
    );
  refresh(`/positions/${positionId}`);
  redirect(`/positions/${positionId}`);
}

// ── events ────────────────────────────────────────────────────────────────

export async function createEvent(fd: FormData) {
  const db = getDb();
  const portfolio = db.prepare("select id from portfolios limit 1").get() as { id: string };
  const id = newId("ev");
  const scenarios = (["Bull", "Base", "Bear"] as const)
    .map((name) => ({
      name,
      probability: int(fd, `prob_${name}`, 0, 100, 0),
      expectedReaction: str(fd, `reaction_${name}`),
      plannedAction: str(fd, `action_${name}`),
    }))
    .filter((s) => s.probability > 0 || s.expectedReaction || s.plannedAction);

  db.prepare(
    `insert into events (id,portfolioId,positionId,title,kind,occurredAt,knownAt,status,marketExpects,
       iExpect,keyVariables,scenarios,outcome,resolvedAt,createdAt)
     values (?,?,?,?,?,?,?, 'upcoming', ?,?,?,?,null,null,?)`
  ).run(
    id,
    portfolio.id,
    str(fd, "positionId") || null,
    str(fd, "title", { required: true, max: 200 }),
    pick(fd, "kind", ["earnings", "macro", "regulatory", "product", "legal"] as const, "earnings"),
    dateOr(fd, "occurredAt"),
    nowIso(),
    str(fd, "marketExpects") || null,
    str(fd, "iExpect") || null,
    JSON.stringify(lines(fd, "keyVariables")),
    JSON.stringify(scenarios),
    nowIso()
  );

  for (const beliefId of fd.getAll("beliefIds").map(String).filter(Boolean)) {
    db.prepare("insert into event_beliefs (id,eventId,beliefId) values (?,?,?)").run(
      newId("eb"),
      id,
      beliefId
    );
  }

  refresh("/events");
  redirect(`/events/${id}`);
}

export async function recordEventOutcome(fd: FormData) {
  const id = str(fd, "eventId", { required: true });
  const outcome = {
    whatHappened: str(fd, "whatHappened", { required: true }),
    actualReaction: str(fd, "actualReaction"),
    forecastAccurate: pick(fd, "forecastAccurate", VERDICTS, "partly"),
    rightVariables: pick(fd, "rightVariables", VERDICTS, "partly"),
    followedPlan: pick(fd, "followedPlan", VERDICTS, "partly"),
    reactionSurprising: pick(fd, "reactionSurprising", VERDICTS, "partly"),
    notes: str(fd, "notes") || undefined,
  };
  getDb()
    .prepare("update events set status='resolved', outcome=?, resolvedAt=? where id=?")
    .run(JSON.stringify(outcome), nowIso(), id);
  refresh(`/events/${id}`, "/patterns");
  redirect(`/events/${id}`);
}

// ── postmortem ────────────────────────────────────────────────────────────

export async function createPostmortem(fd: FormData) {
  const positionId = str(fd, "positionId", { required: true });
  const id = newId("pm");
  const verdicts = {
    thesisCorrect: pick(fd, "thesisCorrect", VERDICTS, "partly"),
    thesisNote: str(fd, "thesisNote") || undefined,
    valuationRight: pick(fd, "valuationRight", VERDICTS, "partly"),
    valuationNote: str(fd, "valuationNote") || undefined,
    sizingRight: pick(fd, "sizingRight", VERDICTS, "partly"),
    sizingNote: str(fd, "sizingNote") || undefined,
    timingRight: pick(fd, "timingRight", VERDICTS, "partly"),
    timingNote: str(fd, "timingNote") || undefined,
    followedProcess: pick(fd, "followedProcess", VERDICTS, "partly"),
    processNote: str(fd, "processNote") || undefined,
    drivenBy: pick(fd, "drivenBy", ["skill", "luck", "external"] as const, "skill"),
    drivenByNote: str(fd, "drivenByNote") || undefined,
  };
  getDb()
    .prepare(
      `insert into postmortems (id,positionId,decisionId,occurredAt,verdicts,lesson,processChange,createdAt)
       values (?,?,?,?,?,?,?,?)`
    )
    .run(
      id,
      positionId,
      str(fd, "decisionId") || null,
      nowIso(),
      JSON.stringify(verdicts),
      str(fd, "lesson", { required: true }),
      str(fd, "processChange") || null,
      nowIso()
    );
  refresh(`/positions/${positionId}`);
  redirect(`/postmortems/${id}`);
}

// ── replay ────────────────────────────────────────────────────────────────

export async function saveReplayAttempt(fd: FormData) {
  const decisionId = str(fd, "decisionId", { required: true });
  const id = newId("rp");
  getDb()
    .prepare(
      `insert into replay_attempts (id,decisionId,createdAt,newChoice,newReasoning,newConfidence,hindsightNote)
       values (?,?,?,?,?,?,null)`
    )
    .run(
      id,
      decisionId,
      nowIso(),
      pick(fd, "newChoice", DECISION_TYPES as readonly DecisionType[], "hold"),
      str(fd, "newReasoning", { required: true }),
      int(fd, "newConfidence", 1, 5, 3)
    );
  refresh(`/replay/${decisionId}`);
  redirect(`/replay/${decisionId}?reveal=${id}`);
}

export async function saveHindsightNote(fd: FormData) {
  const attemptId = str(fd, "attemptId", { required: true });
  const decisionId = str(fd, "decisionId", { required: true });
  getDb()
    .prepare("update replay_attempts set hindsightNote=? where id=?")
    .run(str(fd, "hindsightNote", { required: true }), attemptId);
  refresh(`/replay/${decisionId}`);
  redirect(`/replay/${decisionId}?reveal=${attemptId}`);
}
