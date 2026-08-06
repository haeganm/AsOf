import {
  WEAK_ASSUMPTION_FLOOR,
  getPositionSnapshot,
  getThesisAt,
  listDecisions,
  listEvents,
  wasAddIntoWeakness,
} from "./queries";
import { listMonitors } from "./monitors";
import type { DecisionType } from "./types";
import { DECISION_LABEL } from "./types";
import { relativeDays, pct } from "./format";

/**
 * What your own record says about the decision you are about to record.
 *
 * Everything AsOf knows has until now lived on pages you read afterwards. This
 * moves it to the moment it can still change something: pick a position and an
 * action, and the app answers with your own history for that combination, the
 * rules you wrote for this position, and anything currently firing.
 *
 * Rules only, no model. Every nudge names the record it came from, and none of
 * them tells you what to do — the point is to make the relevant part of your own
 * record impossible to not have read.
 */

export interface Nudge {
  id: string;
  /** stop = your own written rule contradicts this; check = worth a look; context = background. */
  tone: "stop" | "check" | "context";
  headline: string;
  detail: string;
  /** Where it came from, so the claim can be checked. */
  basis?: string;
}

const NO_ADD = /\bno (further |more )?adds?\b|\bnone\b|\bn\/a\b|do not (have|currently)/i;

export function getDecisionNudges(positionId: string | null, type: DecisionType): Nudge[] {
  const out: Nudge[] = [];
  if (!positionId) return out;

  const p = getPositionSnapshot(positionId);
  if (!p) return out;
  const thesis = getThesisAt(positionId);
  const decisions = listDecisions();
  const mine = decisions.filter((d) => d.positionId === positionId);

  // ── The rules you wrote for this position ──────────────────────────────
  if (thesis) {
    const weak = thesis.assumptions.filter((a) => a.status !== "intact");
    const broken = thesis.assumptions.filter((a) => a.status === "broken");

    if (type === "add") {
      if (thesis.addCondition && NO_ADD.test(thesis.addCondition)) {
        out.push({
          id: "nudge_no_add",
          tone: "stop",
          headline: `Thesis v${thesis.versionNo} says you would not add to this`,
          detail: `You wrote: "${thesis.addCondition}"`,
          basis: `Thesis v${thesis.versionNo}, written ${relativeDays(thesis.occurredAt)}`,
        });
      } else if (thesis.addCondition) {
        out.push({
          id: "nudge_add_condition",
          tone: "check",
          headline: "Your written add condition",
          detail: `"${thesis.addCondition}" — is it met, on the thesis and not only on the price?`,
          basis: `Thesis v${thesis.versionNo}`,
        });
      }

      if (weak.length >= WEAK_ASSUMPTION_FLOOR) {
        const priorWeakAdds = decisions.filter((d) => d.type === "add" && wasAddIntoWeakness(d));
        const judged = priorWeakAdds.filter((d) => d.outcomeVerdict);
        const failed = judged.filter((d) => d.outcomeVerdict === "did_not_work");
        out.push({
          id: "nudge_add_weak",
          tone: "stop",
          headline: `${weak.length} of ${thesis.assumptions.length} assumptions here are no longer intact`,
          detail:
            weak.map((a) => `${a.status === "broken" ? "Broken" : "Weakening"}: ${a.text}`).join(" · ") +
            (judged.length > 0
              ? ` You have added into a weakening thesis ${priorWeakAdds.length} time${priorWeakAdds.length === 1 ? "" : "s"} before; of the ${judged.length} you have judged, ${failed.length} did not work.`
              : " You have not done this before, so there is no base rate yet."),
          basis: judged.length > 0 ? "Your own closed loops" : undefined,
        });
      }
    }

    if ((type === "reduce" || type === "exit") && thesis.exitCondition) {
      const named = broken.filter((a) =>
        new RegExp(`\\b${a.id}\\b`, "i").test(thesis.exitCondition ?? "")
      );
      out.push({
        id: "nudge_exit_condition",
        tone: named.length > 0 ? "context" : "check",
        headline:
          named.length > 0
            ? "This is the rule executing, not a change of view"
            : "Your written exit condition",
        detail:
          `"${thesis.exitCondition}"` +
          (named.length > 0
            ? " — the assumption it names is already broken, so recording this as a plan execution rather than a reaction is accurate."
            : " — if this is not what fired, say what did, so the reduction is reviewable later."),
        basis: `Thesis v${thesis.versionNo}`,
      });
    }

    if (type === "hold" && broken.length > 0) {
      const rule = [thesis.exitCondition, thesis.trimCondition].find((c) =>
        broken.some((a) => c && new RegExp(`\\b${a.id}\\b`, "i").test(c))
      );
      if (rule) {
        out.push({
          id: "nudge_hold_against_rule",
          tone: "stop",
          headline: "You are holding against a condition you wrote",
          detail: `"${rule}" — and it names an assumption now marked broken. Holding is a legitimate choice, but it is a decision to override your own rule, so say that here rather than leaving it implicit.`,
          basis: `Thesis v${thesis.versionNo}`,
        });
      }
    }
  }

  // ── Reductions are your least reviewable decisions ─────────────────────
  if (type === "reduce" || type === "exit") {
    const cuts = decisions.filter((d) => d.type === "reduce" || d.type === "exit");
    const noTrigger = cuts.filter((d) => (d.reversalTrigger ?? "").trim().length === 0);
    if (cuts.length >= 2 && noTrigger.length > 0) {
      out.push({
        id: "nudge_cut_trigger",
        tone: "check",
        headline: `${noTrigger.length} of your ${cuts.length} past reductions recorded no reversal condition`,
        detail:
          "A reduction with nothing that would reverse it cannot be reviewed later, only defended. Fill in the reversal field even if the answer is 'nothing would' — that is itself a finding.",
        basis: "Your own decision log",
      });
    }
  }

  // ── Size and concentration ─────────────────────────────────────────────
  if (type === "add" && p.weightPct > 0) {
    const ceiling = /(\d{1,2})\s*%/.exec(thesis?.trimCondition ?? "");
    out.push({
      id: "nudge_weight",
      tone: ceiling && p.weightPct >= Number(ceiling[1]) * 0.85 ? "check" : "context",
      headline: `${p.ticker} is already ${pct(p.weightPct)} of the book`,
      detail: ceiling
        ? `Your trim condition mentions ${ceiling[1]}%. Adding moves you toward the ceiling you set, not away from it.`
        : "No written weight ceiling for this position, so nothing will tell you when it has become too large except you.",
      basis: ceiling ? `Thesis v${thesis!.versionNo}` : undefined,
    });
  }

  // ── Anything currently firing ──────────────────────────────────────────
  const fired = listMonitors(positionId).filter((m) => m.state === "fired");
  for (const m of fired) {
    out.push({
      id: `nudge_monitor_${m.id}`,
      tone: "check",
      headline: `A condition you set is currently met: ${m.label}`,
      detail: m.meaning ?? "You did not write down what this would mean. Worth doing now.",
      basis: "Monitor",
    });
  }

  // ── A catalyst you already have a plan for ─────────────────────────────
  const soon = listEvents({ positionId, status: "upcoming" })
    .filter((e) => e.occurredAt > new Date().toISOString())
    .slice(0, 1);
  for (const e of soon) {
    const planned = e.scenarios.filter((s) => s.plannedAction);
    out.push({
      id: `nudge_event_${e.id}`,
      tone: "context",
      headline: `"${e.title}" is ${relativeDays(e.occurredAt)}`,
      detail:
        planned.length > 0
          ? `You already wrote what you would do: ${planned.map((s) => `${s.name} — ${s.plannedAction}`).join(" · ")}`
          : "You have no planned action recorded for it. Acting before a catalyst you have not thought through is the expensive kind of early.",
      basis: "Your event plan",
    });
  }

  // ── Calibration, when there is enough of it to mean anything ───────────
  const resolved = decisions.filter((d) => d.outcomeVerdict);
  const sameType = resolved.filter((d) => d.type === type);
  if (sameType.length >= 3) {
    const worked = sameType.filter((d) => d.outcomeVerdict === "worked").length;
    out.push({
      id: "nudge_type_base_rate",
      tone: "context",
      headline: `Your record on ${DECISION_LABEL[type].toLowerCase()} decisions: ${worked} of ${sameType.length} worked`,
      detail:
        "Counted from the outcomes you wrote yourself, so it measures the consistency of your judgment rather than the market's.",
      basis: `${sameType.length} closed loops`,
    });
  }

  const rank = { stop: 0, check: 1, context: 2 };
  return out.sort((a, b) => rank[a.tone] - rank[b.tone]);
}
