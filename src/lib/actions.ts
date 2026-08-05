"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { nextAssumptionIds } from "./assumptions";
import { ensurePortfolio, getDb, newId, nowIso } from "./db";
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
  const raw = str(fd, key);
  // Number("") is 0, which is finite — so an absent field used to clamp to `min`
  // and record a conviction of 1/5 the user never chose.
  if (raw.length === 0) {
    if (fallback !== undefined) return fallback;
    throw new Error(`“${key}” is required.`);
  }
  const n = Number(raw);
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

/**
 * Dates are entered as `yyyy-mm-dd`. Parsed as midday UTC so the stored day
 * cannot shift under a timezone, and rejected rather than silently filed as
 * today — misdating a record is the one error this product cannot absorb.
 */
function dateOr(fd: FormData, key: string, fallback = nowIso()): string {
  const v = str(fd, key);
  if (!v) return fallback;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error(`“${key}” must be a date (yyyy-mm-dd).`);
  const d = new Date(`${v}T12:00:00.000Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`“${key}” is not a real date.`);
  // A record dated in the future would be counted in today's holdings and prices.
  if (d.getTime() > Date.now() + DAY) throw new Error(`“${key}” cannot be in the future.`);
  return d.toISOString();
}

const DAY = 86_400_000;

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
  const texts = lines(fd, "assumptions_new");
  const ids = nextAssumptionIds(existing, texts.length);
  texts.forEach((text, i) => out.push({ id: ids[i], text, status: "intact" }));
  return out;
}

/** Throws unless the row exists. An unvalidated id can permanently 500 a page. */
function mustExist(table: "positions" | "decisions" | "events" | "replay_attempts", id: string) {
  const row = getDb().prepare(`select 1 as ok from ${table} where id=?`).get(id);
  if (!row) throw new Error(`No such ${table.replace(/s$/, "")}: ${id}`);
}

function refresh(...paths: string[]) {
  revalidatePath("/", "layout");
  for (const p of paths) revalidatePath(p);
}

// ── positions & theses ────────────────────────────────────────────────────

export async function createPosition(fd: FormData) {
  const db = getDb();

  // Everything is read and validated before a single row is written. Previously
  // the required-field check on `summary` ran after positions/lots/marks had
  // already committed, so an empty summary left an orphan position behind.
  const portfolio = ensurePortfolio(db);
  const ticker = str(fd, "ticker", { required: true, max: 12 }).toUpperCase();
  const name = str(fd, "name", { required: true, max: 120 }) || ticker;
  const summary = str(fd, "summary", { required: true });
  const kind = pick(fd, "kind", ["open", "watching", "passed"] as const, "open");
  const at = dateOr(fd, "occurredAt");
  const shares = float(fd, "shares");
  const price = float(fd, "price");
  if (shares < 0) throw new Error("Shares cannot be negative.");
  if (price < 0) throw new Error("Price cannot be negative.");
  const confidence = int(fd, "confidence", 1, 5, 3);
  const assetClass = str(fd, "assetClass", { max: 80 }) || null;
  const marketView = str(fd, "marketView") || null;
  const variantView = str(fd, "variantView") || null;
  const assumptions = assumptionsFrom(fd, []);
  const catalysts = lines(fd, "catalysts");
  const risks = lines(fd, "risks");
  const falsifiers = lines(fd, "falsifiers");
  const why = str(fd, "why") || variantView || summary;
  const beliefIds = [...new Set(fd.getAll("beliefIds").map(String).filter(Boolean))];
  const known = new Set(
    (db.prepare("select id from beliefs").all() as Array<{ id: string }>).map((b) => b.id)
  );
  for (const b of beliefIds) if (!known.has(b)) throw new Error(`No such belief: ${b}`);

  const positionId = newId("pos");
  // `createdAt` is the write time, always. `occurredAt` carries the date the
  // user gave — conflating them destroys the only audit trail that can prove a
  // backdated record was backdated.
  const written = nowIso();

  db.transaction(() => {
    db.prepare(
      `insert into positions (id,portfolioId,ticker,name,assetClass,status,openedAt,closedAt,createdAt)
       values (?,?,?,?,?,?,?,null,?)`
    ).run(positionId, portfolio, ticker, name, assetClass, kind, kind === "open" ? at : null, at);

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

    db.prepare(
      `insert into thesis_versions
       (id,positionId,versionNo,occurredAt,summary,marketView,variantView,assumptions,catalysts,risks,
        falsifiers,horizon,addCondition,trimCondition,exitCondition,confidence,changeNote,createdAt)
       values (?,?,1,?,?,?,?,?,?,?,?,?,?,?,?,?,null,?)`
    ).run(
      newId("th"),
      positionId,
      at,
      summary,
      marketView,
      variantView,
      JSON.stringify(assumptions),
      JSON.stringify(catalysts),
      JSON.stringify(risks),
      JSON.stringify(falsifiers),
      str(fd, "horizon", { max: 80 }) || null,
      str(fd, "addCondition") || null,
      str(fd, "trimCondition") || null,
      str(fd, "exitCondition") || null,
      confidence,
      written
    );

    // The act of opening (or declining) is itself a decision worth keeping.
    db.prepare(
      `insert into decisions (id,portfolioId,positionId,occurredAt,type,what,why,expectation,confidence,
         mainRisk,reversalTrigger,linkedEventId,outcomeAt,outcomeNote,outcomeVerdict,createdAt)
       values (?,?,?,?,?,?,?,?,?,?,?,null,null,null,null,?)`
    ).run(
      newId("dec"),
      portfolio,
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
      confidence,
      risks[0] ?? null,
      falsifiers[0] ?? null,
      written
    );

    for (const beliefId of beliefIds) {
      db.prepare(
        `insert into position_beliefs (id,positionId,beliefId,relationship,sensitivity,occurredAt,createdAt)
         values (?,?,?,?,?,?,?)`
      ).run(newId("pb"), positionId, beliefId, null, "high", at, written);
    }
  })();

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

  const summary = str(fd, "summary", { required: true });
  const changeNote = str(fd, "changeNote", { required: true });
  const confidence = int(fd, "confidence", 1, 5, current.confidence);
  const assumptions = assumptionsFrom(fd, current.assumptions);
  const portfolio = ensurePortfolio(db);
  const nextNo = current.versionNo + 1;

  db.transaction(() => {
    db.prepare(
      `insert into thesis_versions
       (id,positionId,versionNo,occurredAt,summary,marketView,variantView,assumptions,catalysts,risks,
        falsifiers,horizon,addCondition,trimCondition,exitCondition,confidence,changeNote,createdAt)
       values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      newId("th"),
      positionId,
      nextNo,
      at,
      summary,
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
      confidence,
      changeNote,
      at
    );

    db.prepare(
      `insert into decisions (id,portfolioId,positionId,occurredAt,type,what,why,expectation,confidence,
         mainRisk,reversalTrigger,linkedEventId,outcomeAt,outcomeNote,outcomeVerdict,createdAt)
       values (?,?,?,?, 'thesis_change', ?,?,null,?,null,null,null,null,null,null,?)`
    ).run(
      newId("dec"),
      portfolio,
      positionId,
      at,
      `Thesis updated to v${nextNo}.`,
      changeNote,
      confidence,
      at
    );
  })();

  refresh(`/positions/${positionId}`);
  redirect(`/positions/${positionId}`);
}

// ── decisions ─────────────────────────────────────────────────────────────

export async function recordDecision(fd: FormData) {
  const db = getDb();
  const portfolio = ensurePortfolio(db);
  const positionId = str(fd, "positionId") || null;
  const type = pick(fd, "type", DECISION_TYPES as readonly DecisionType[], "hold");
  const at = dateOr(fd, "occurredAt");
  const what = str(fd, "what", { required: true });
  const why = str(fd, "why", { required: true });
  const confidence = int(fd, "confidence", 1, 5, 3);
  const linkedEventId = str(fd, "linkedEventId") || null;
  const shares = float(fd, "shares");
  const price = float(fd, "price");
  const id = newId("dec");

  // An unvalidated position id here permanently 500s the Replay index, which has
  // no UI to delete the offending row.
  if (positionId) mustExist("positions", positionId);
  if (linkedEventId) mustExist("events", linkedEventId);
  if (shares < 0 || price < 0) throw new Error("Shares and price cannot be negative.");

  const movesSize =
    !!positionId && shares > 0 && price > 0 && ["open", "add", "reduce", "exit"].includes(type);
  if (movesSize && (type === "reduce" || type === "exit")) {
    const held = (
      db
        .prepare("select coalesce(sum(deltaShares),0) as s from lots where positionId=? and occurredAt<=?")
        .get(positionId, at) as { s: number }
    ).s;
    if (shares > held + 0.0001) {
      throw new Error(
        `Cannot sell ${shares} shares — you held ${held} on that date.`
      );
    }
  }
  // Recording a size change and silently not moving the size leaves the decision
  // log and the share ledger disagreeing with no error shown.
  if (!movesSize && (shares > 0 || price > 0) && ["open", "add", "reduce", "exit"].includes(type)) {
    throw new Error("A size change needs both a share count and a price.");
  }

  db.transaction(() => {
    db.prepare(
      `insert into decisions (id,portfolioId,positionId,occurredAt,type,what,why,expectation,confidence,
         mainRisk,reversalTrigger,linkedEventId,outcomeAt,outcomeNote,outcomeVerdict,createdAt)
       values (?,?,?,?,?,?,?,?,?,?,?,?,null,null,null,?)`
    ).run(
      id,
      portfolio,
      positionId,
      at,
      type,
      what,
      why,
      str(fd, "expectation") || null,
      confidence,
      str(fd, "mainRisk") || null,
      str(fd, "reversalTrigger") || null,
      linkedEventId,
      nowIso()
    );

    if (movesSize) {
      const signed = type === "reduce" || type === "exit" ? -Math.abs(shares) : Math.abs(shares);
      db.prepare(
        "insert into lots (id,positionId,occurredAt,deltaShares,price,note) values (?,?,?,?,?,?)"
      ).run(newId("lot"), positionId, at, signed, price, what);
      db.prepare(
        "insert into marks (id,positionId,occurredAt,price) values (?,?,?,?) on conflict do update set price=excluded.price"
      ).run(newId("mk"), positionId, at, price);
      const held = db
        .prepare("select coalesce(sum(deltaShares),0) as s from lots where positionId=?")
        .get(positionId) as { s: number };
      if (held.s <= 0.0001) {
        db.prepare("update positions set status='closed', closedAt=? where id=?").run(at, positionId);
      }
    }
  })();

  refresh(positionId ? `/positions/${positionId}` : "/decisions");
  redirect(`/decisions/${id}`);
}

/** Closes the loop on a past decision. This is what makes the pattern engine work. */
export async function recordDecisionOutcome(fd: FormData) {
  const id = str(fd, "decisionId", { required: true });
  mustExist("decisions", id);
  const note = str(fd, "outcomeNote", { required: true });
  // No silent fallback: a tampered verdict must not be recorded as the user's.
  const verdict = str(fd, "outcomeVerdict");
  if (!["worked", "mixed", "did_not_work"].includes(verdict)) {
    throw new Error("Choose whether the decision worked, was mixed, or did not work.");
  }
  getDb()
    .prepare("update decisions set outcomeAt=?, outcomeNote=?, outcomeVerdict=? where id=?")
    .run(nowIso(), note, verdict, id);
  refresh("/patterns", `/decisions/${id}`);
  redirect(`/decisions/${id}`);
}

// ── evidence ──────────────────────────────────────────────────────────────

export async function addEvidence(fd: FormData) {
  const positionId = str(fd, "positionId", { required: true });
  mustExist("positions", positionId);
  const contradicts = str(fd, "contradictsAssumptionId");
  const at = dateOr(fd, "occurredAt");
  // The assumption must exist in the thesis that was in force when the evidence
  // arrived, or the contradiction resolves to nothing on the position page.
  if (contradicts) {
    const thesis = getThesisAt(positionId, at);
    if (!thesis?.assumptions.some((a) => a.id === contradicts)) {
      throw new Error(`No assumption “${contradicts}” in the thesis in force on that date.`);
    }
  }
  getDb()
    .prepare(
      `insert into evidence (id,positionId,occurredAt,kind,source,title,body,stance,contradictsAssumptionId,createdAt)
       values (?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      newId("evd"),
      positionId,
      at,
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
  const portfolio = ensurePortfolio(db);
  const id = newId("ev");
  const positionId = str(fd, "positionId") || null;
  if (positionId) mustExist("positions", positionId);

  const scenarios = (["Bull", "Base", "Bear"] as const)
    .map((name) => ({
      name,
      probability: int(fd, `prob_${name}`, 0, 100, 0),
      expectedReaction: str(fd, `reaction_${name}`),
      plannedAction: str(fd, `action_${name}`),
    }))
    .filter((s) => s.probability > 0 || s.expectedReaction || s.plannedAction);

  // Scenario probabilities are a forecast; one that does not sum to 100 cannot
  // be scored, and the UI would render three full bars without saying so.
  const totalProb = scenarios.reduce((s, x) => s + x.probability, 0);
  if (scenarios.length > 0 && totalProb !== 100) {
    throw new Error(`Scenario probabilities must sum to 100 — they currently sum to ${totalProb}.`);
  }

  const beliefIds = [...new Set(fd.getAll("beliefIds").map(String).filter(Boolean))];
  const known = new Set(
    (db.prepare("select id from beliefs").all() as Array<{ id: string }>).map((b) => b.id)
  );
  for (const b of beliefIds) if (!known.has(b)) throw new Error(`No such belief: ${b}`);

  const written = nowIso();
  // An event may legitimately be dated in the future — it has not happened yet.
  const occurs = str(fd, "occurredAt");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(occurs)) throw new Error("“occurredAt” must be a date (yyyy-mm-dd).");
  const occursIso = new Date(`${occurs}T12:00:00.000Z`).toISOString();

  db.transaction(() => {
    db.prepare(
      `insert into events (id,portfolioId,positionId,title,kind,occurredAt,knownAt,status,marketExpects,
         iExpect,keyVariables,scenarios,outcome,resolvedAt,createdAt)
       values (?,?,?,?,?,?,?, 'upcoming', ?,?,?,?,null,null,?)`
    ).run(
      id,
      portfolio,
      positionId,
      str(fd, "title", { required: true, max: 200 }),
      pick(fd, "kind", ["earnings", "macro", "regulatory", "product", "legal"] as const, "earnings"),
      occursIso,
      written,
      str(fd, "marketExpects") || null,
      str(fd, "iExpect") || null,
      JSON.stringify(lines(fd, "keyVariables")),
      JSON.stringify(scenarios),
      written
    );

    for (const beliefId of beliefIds) {
      db.prepare(
        "insert into event_beliefs (id,eventId,beliefId,occurredAt) values (?,?,?,?)"
      ).run(newId("eb"), id, beliefId, written);
    }
  })();

  refresh("/events");
  redirect(`/events/${id}`);
}

export async function recordEventOutcome(fd: FormData) {
  const id = str(fd, "eventId", { required: true });
  mustExist("events", id);
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
  mustExist("positions", positionId);
  const decisionId = str(fd, "decisionId") || null;
  if (decisionId) mustExist("decisions", decisionId);
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
      decisionId,
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
  mustExist("decisions", decisionId);
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
  const note = str(fd, "hindsightNote", { required: true });
  // Scoped to the decision it was submitted under, so a note cannot be attached
  // to some other decision's attempt.
  const owned = getDb()
    .prepare("select 1 as ok from replay_attempts where id=? and decisionId=?")
    .get(attemptId, decisionId);
  if (!owned) throw new Error("That replay attempt does not belong to this decision.");
  getDb().prepare("update replay_attempts set hindsightNote=? where id=?").run(note, attemptId);
  refresh(`/replay/${decisionId}`);
  redirect(`/replay/${decisionId}?reveal=${attemptId}`);
}
