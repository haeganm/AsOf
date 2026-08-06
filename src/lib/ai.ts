import "server-only";
import { generateObject } from "ai";
import { z } from "zod";

/**
 * The optional model layer.
 *
 * Everything that produces a number in AsOf is deterministic and stays that way.
 * A model is only used for the qualitative work it is genuinely better at:
 * turning prose into structure, and reading a filing against a thesis. Nothing
 * here computes a return, a weight, a correlation or a base rate.
 *
 * Rules this file exists to enforce:
 *   - Absent key, every feature that uses it is hidden. Nothing degrades.
 *   - Provider-agnostic. Set ASOF_AI_MODEL to "anthropic:<id>" or "openai:<id>".
 *   - Nothing leaves the machine unless the user pressed the button that sends
 *     it, and the UI says what is being sent.
 *   - Every model-authored record is marked as such and is editable. The model
 *     drafts; the user owns.
 *   - The key is read from the environment and never logged, echoed, or stored.
 */

import { aiConfig, keyFor } from "./ai-config";

export { aiConfig, aiEnabled, aiLabel, type AiConfig, type Provider } from "./ai-config";

async function model() {
  const cfg = aiConfig();
  if (!cfg) throw new Error("No model configured.");
  if (cfg.provider === "anthropic") {
    const { createAnthropic } = await import("@ai-sdk/anthropic");
    return createAnthropic({ apiKey: keyFor("anthropic")! })(cfg.modelId);
  }
  const { createOpenAI } = await import("@ai-sdk/openai");
  return createOpenAI({ apiKey: keyFor("openai")! })(cfg.modelId);
}

// ── schemas ───────────────────────────────────────────────────────────────

const ThesisDraft = z.object({
  summary: z.string().describe("One sentence: why this investment should work."),
  marketView: z.string().describe("What the consensus appears to believe."),
  variantView: z.string().describe("What the author believes differently, and why."),
  assumptions: z
    .array(z.string())
    .describe("Load-bearing claims that must hold. Each independently checkable."),
  falsifiers: z
    .array(z.string())
    .describe("Specific, observable things that would prove the thesis wrong."),
  risks: z.array(z.string()),
  catalysts: z.array(z.string()),
  horizon: z.string().describe("Expected holding period, e.g. '18-30 months'."),
  vagueClaims: z
    .array(z.string())
    .describe("Phrases in the source that are unfalsifiable or purely directional."),
});
export type ThesisDraft = z.infer<typeof ThesisDraft>;

const FilingRead = z.object({
  summary: z.string().describe("What the document says, in two or three sentences."),
  touches: z
    .array(
      z.object({
        assumptionId: z.string(),
        direction: z.enum(["supports", "contradicts", "unclear"]),
        why: z.string().describe("The specific sentence or figure that does it."),
      })
    )
    .describe("Only assumptions the document genuinely speaks to. Omit the rest."),
  newDependency: z
    .string()
    .describe("Anything the thesis would now quietly depend on that it did not before. Empty if none."),
  questions: z.array(z.string()).describe("What to check next, phrased as questions."),
});
export type FilingRead = z.infer<typeof FilingRead>;

const SYSTEM = `You help a professional investor keep their own reasoning honest.

Hard rules:
- Never recommend buying, selling or holding. Never predict a price.
- Never invent a fact, figure or quotation. If the source does not say it, omit it.
- Prefer the investor's own words over your paraphrase.
- An assumption must be independently checkable. "The company will do well" is not
  an assumption; "gross margin recovers above 44% as clearance normalises" is.
- A falsifier must be specific enough that the investor could not argue their way
  out of it later.
- Flag vague or unfalsifiable language rather than tidying it away.`;

// ── features ──────────────────────────────────────────────────────────────

/** Turns pasted research into a structured thesis draft. */
export async function draftThesis(input: {
  ticker: string;
  notes: string;
}): Promise<ThesisDraft> {
  const { object } = await generateObject({
    model: await model(),
    schema: ThesisDraft,
    system: SYSTEM,
    prompt: `Structure the following notes on ${input.ticker} into a thesis.

Use only what is present. Where the notes are thin, return a short honest value
rather than inventing detail. Put anything unfalsifiable into vagueClaims rather
than restating it as an assumption.

NOTES
-----
${input.notes.slice(0, 20_000)}`,
  });
  return object;
}

/** Reads a document against the assumptions a thesis actually rests on. */
export async function readAgainstThesis(input: {
  ticker: string;
  thesisSummary: string;
  assumptions: Array<{ id: string; text: string; status: string }>;
  document: string;
}): Promise<FilingRead> {
  const { object } = await generateObject({
    model: await model(),
    schema: FilingRead,
    system: SYSTEM,
    prompt: `A document has arrived for ${input.ticker}. Read it against the thesis.

THESIS
------
${input.thesisSummary}

ASSUMPTIONS
-----------
${input.assumptions.map((a) => `${a.id} [${a.status}]: ${a.text}`).join("\n")}

Only list assumptions the document genuinely speaks to, and quote the specific
sentence or figure that does it. If it speaks to none, return an empty list —
that is a useful answer.

DOCUMENT
--------
${input.document.slice(0, 40_000)}`,
  });
  // Never let a hallucinated id through to the database.
  const known = new Set(input.assumptions.map((a) => a.id));
  return { ...object, touches: object.touches.filter((t) => known.has(t.assumptionId)) };
}
