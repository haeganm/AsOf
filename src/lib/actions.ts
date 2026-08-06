"use server";

import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { echo, toMessage, type ActionState } from "./action-state";
import { nextAssumptionIds } from "./assumptions";
import { ensurePortfolio, getDb, newId, nowIso } from "./db";
import { syncPrices } from "./ingest/prices";
import { getSecurity } from "./ingest/securities";
import { getThesisAt } from "./queries";
import { createMonitor, evaluateMonitors } from "./monitors";
import { aiEnabled, aiLabel, readAgainstThesis } from "./ai";
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
 * Dates are entered as `yyyy-mm-dd` and stored at *local* midday.
 *
 * Storing midday UTC put the instant on the wrong local calendar day for anyone
 * far enough east or west, so a record entered as the 5th displayed as the 6th.
 * Local midday keeps the rendered day equal to the day that was typed, with
 * twelve hours of slack either side.
 *
 * Rejected rather than silently filed as today — misdating a record is the one
 * error this product cannot absorb.
 */
function dateOr(fd: FormData, key: string, fallback = nowIso()): string {
  const v = str(fd, key);
  if (!v) return fallback;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) throw new Error(`“${key}” must be a date (yyyy-mm-dd).`);
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0);
  if (Number.isNaN(d.getTime())) throw new Error(`“${key}” is not a real date.`);
  // Compared against the end of today, so "today" is never rejected as future.
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  if (d.getTime() > endOfToday.getTime()) {
    throw new Error(
      `That date is in the future. A record can only be dated today or earlier — use an event if you are planning ahead.`
    );
  }
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

/**
 * Runs an action body and turns a broken business rule into returned state
 * rather than an unhandled server error.
 *
 * `unstable_rethrow` is essential: `redirect()` signals success by throwing a
 * framework error, so swallowing everything would turn every successful save
 * into a reported failure.
 */
async function run(fd: FormData, body: () => Promise<void>): Promise<ActionState> {
  try {
    await body();
    return { error: null };
  } catch (err) {
    unstable_rethrow(err);
    // The submission travels back so the form can restore what was typed.
    return { error: toMessage(err), values: echo(fd) };
  }
}

// ── positions & theses ────────────────────────────────────────────────────

async function createPositionImpl(fd: FormData) {
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

  // A CIK is only trusted if it matches the cached universe entry for this
  // ticker, so a hand-edited query string cannot attach the wrong company.
  const security = getSecurity(ticker);
  const cik = security?.cik ?? null;

  // One instrument, one position. Two rows for the same ticker double-count the
  // book, give the belief matrix two indistinguishable columns, and make every
  // position dropdown ambiguous.
  const clash = db
    .prepare("select id, status from positions where upper(ticker)=? limit 1")
    .get(ticker) as { id: string; status: string } | undefined;
  if (clash) {
    throw new Error(
      `${ticker} is already in the book. Record an add against the existing position rather than opening a second one.`
    );
  }

  db.transaction(() => {
    db.prepare(
      `insert into positions (id,portfolioId,ticker,name,assetClass,status,openedAt,closedAt,createdAt,cik,demo)
       values (?,?,?,?,?,?,?,null,?,?,0)`
    ).run(positionId, portfolio, ticker, name, assetClass, kind, kind === "open" ? at : null, at, cik);

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

  // Real price history, fetched in the background. Deliberately after the
  // transaction and deliberately swallowed: a network failure must not lose the
  // position the user just wrote, and the manual mark above already renders.
  try {
    await syncPrices(positionId, ticker);
  } catch {
    // Recorded in ingest_runs; the position stands on the mark that was entered.
  }

  refresh();
  redirect(`/positions/${positionId}`);
}

/** Never mutates the prior version — a new row is the only way to change a view. */
async function updateThesisImpl(fd: FormData) {
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

async function recordDecisionImpl(fd: FormData) {
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
async function recordDecisionOutcomeImpl(fd: FormData) {
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

async function addEvidenceImpl(fd: FormData) {
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

async function createEventImpl(fd: FormData) {
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

async function recordEventOutcomeImpl(fd: FormData) {
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

async function createPostmortemImpl(fd: FormData) {
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

// ── monitors ──────────────────────────────────────────────────────────────

async function addMonitorImpl(fd: FormData) {
  const positionId = str(fd, "positionId", { required: true });
  mustExist("positions", positionId);
  const kind = pick(
    fd,
    "kind",
    ["price_level", "price_change", "drawdown", "series_level", "series_change", "deadline"] as const,
    "price_level"
  );
  const label = str(fd, "label", { required: true, max: 160 });
  const assumptionId = str(fd, "assumptionId") || null;
  if (assumptionId) {
    const thesis = getThesisAt(positionId);
    if (!thesis?.assumptions.some((a) => a.id === assumptionId)) {
      throw new Error(`No assumption “${assumptionId}” in the current thesis.`);
    }
  }

  let symbol = str(fd, "symbol", { max: 16 }).toUpperCase();
  let threshold: number;
  const comparator = pick(fd, "comparator", ["above", "below"] as const, "below");

  if (kind === "deadline") {
    const by = str(fd, "byDate", { required: true });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(by)) throw new Error("Give the date as yyyy-mm-dd.");
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(by)!;
    threshold = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0).getTime();
    // A deadline needs no series; keep the position's own ticker for display.
    if (!symbol) {
      symbol = (
        getDb().prepare("select ticker from positions where id=?").get(positionId) as {
          ticker: string;
        }
      ).ticker;
    }
  } else {
    if (!symbol) throw new Error("Which symbol should be watched?");
    threshold = float(fd, "threshold", { required: true });
    if (!Number.isFinite(threshold)) throw new Error("The threshold must be a number.");
    // A drawdown is expressed as a negative percentage; accept either sign.
    if (kind === "drawdown") threshold = -Math.abs(threshold);
    const hasSeries = (
      getDb()
        .prepare("select count(*) as n from marks where positionId=?")
        .get(`sym_${symbol.replace(/[^A-Z0-9]/g, "_")}`) as { n: number }
    ).n;
    if (hasSeries === 0) {
      throw new Error(
        `No price history cached for ${symbol}. Run \`npm run ingest\` first, or pick a symbol already in the book.`
      );
    }
  }

  createMonitor({
    positionId,
    assumptionId,
    beliefId: str(fd, "beliefId") || null,
    kind,
    symbol,
    comparator,
    threshold,
    windowDays: kind === "price_level" || kind === "series_level" || kind === "deadline"
      ? null
      : int(fd, "windowDays", 5, 730, 90),
    label,
    meaning: str(fd, "meaning") || null,
  });

  // Evaluate straight away: a condition already met should say so now, not after
  // the next ingestion run.
  evaluateMonitors();
  refresh(`/positions/${positionId}`);
  redirect(`/positions/${positionId}`);
}

// ── optional model-assisted drafting ──────────────────────────────────────

/**
 * Reads a pasted document against the current thesis and files what it finds as
 * evidence — one row per assumption the document genuinely speaks to.
 *
 * Everything written is marked `origin='ingested'` and stays editable. The model
 * drafts; the user owns. Nothing is sent anywhere until this action runs, which
 * only happens on an explicit button press.
 */
async function readDocumentImpl(fd: FormData) {
  if (!aiEnabled()) throw new Error("No model is configured, so this cannot run.");
  const positionId = str(fd, "positionId", { required: true });
  mustExist("positions", positionId);
  const document = str(fd, "document", { required: true, max: 60_000 });
  const source = str(fd, "source", { max: 160 }) || "Pasted document";
  const at = dateOr(fd, "occurredAt");

  const db = getDb();
  const p = db.prepare("select ticker from positions where id=?").get(positionId) as {
    ticker: string;
  };
  const thesis = getThesisAt(positionId);
  if (!thesis) throw new Error("This position has no thesis to read the document against.");

  const result = await readAgainstThesis({
    ticker: p.ticker,
    thesisSummary: thesis.summary,
    assumptions: thesis.assumptions,
    document,
  });

  const written = nowIso();
  db.transaction(() => {
    // The overall read, always recorded so there is a trace even when it found
    // nothing to link.
    db.prepare(
      `insert into evidence (id,positionId,occurredAt,kind,source,title,body,stance,contradictsAssumptionId,createdAt,origin,externalId)
       values (?,?,?, 'fact', ?, ?, ?, 'neutral', null, ?, 'ingested', null)`
    ).run(
      newId("evd"),
      positionId,
      at,
      source,
      `${p.ticker}: ${source}`,
      result.summary +
        (result.newDependency ? `\n\nNew dependency noted: ${result.newDependency}` : "") +
        (result.questions.length ? `\n\nTo check: ${result.questions.join(" · ")}` : "") +
        `\n\nRead by ${aiLabel()}. Drafted, not verified.`,
      written
    );

    for (const t of result.touches) {
      if (t.direction === "unclear") continue;
      db.prepare(
        `insert into evidence (id,positionId,occurredAt,kind,source,title,body,stance,contradictsAssumptionId,createdAt,origin,externalId)
         values (?,?,?, 'fact', ?, ?, ?, ?, ?, ?, 'ingested', null)`
      ).run(
        newId("evd"),
        positionId,
        at,
        source,
        `${p.ticker}: ${t.direction === "contradicts" ? "against" : "supports"} “${
          thesis.assumptions.find((a) => a.id === t.assumptionId)?.text.slice(0, 70) ?? t.assumptionId
        }”`,
        `${t.why}\n\nDrafted by ${aiLabel()} from ${source}. Edit or delete it if the reading is wrong.`,
        t.direction,
        t.direction === "contradicts" ? t.assumptionId : null,
        written
      );
    }
  })();

  refresh(`/positions/${positionId}`);
  redirect(`/positions/${positionId}`);
}

// ── replay ────────────────────────────────────────────────────────────────

async function saveReplayAttemptImpl(fd: FormData) {
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

async function saveHindsightNoteImpl(fd: FormData) {
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

// ── exported actions ──────────────────────────────────────────────────────
// Thin wrappers so a failed rule comes back as state the form can display,
// instead of an unhandled error that discards everything the user wrote.

export async function createPosition(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return run(fd, () => createPositionImpl(fd));
}

export async function updateThesis(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return run(fd, () => updateThesisImpl(fd));
}

export async function recordDecision(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return run(fd, () => recordDecisionImpl(fd));
}

export async function recordDecisionOutcome(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return run(fd, () => recordDecisionOutcomeImpl(fd));
}

export async function addEvidence(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return run(fd, () => addEvidenceImpl(fd));
}

export async function createEvent(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return run(fd, () => createEventImpl(fd));
}

export async function recordEventOutcome(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return run(fd, () => recordEventOutcomeImpl(fd));
}

export async function createPostmortem(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return run(fd, () => createPostmortemImpl(fd));
}

export async function saveReplayAttempt(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return run(fd, () => saveReplayAttemptImpl(fd));
}

export async function saveHindsightNote(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return run(fd, () => saveHindsightNoteImpl(fd));
}

export async function addMonitor(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return run(fd, () => addMonitorImpl(fd));
}

export async function readDocument(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return run(fd, () => readDocumentImpl(fd));
}
