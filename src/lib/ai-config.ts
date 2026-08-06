/**
 * Which model, if any, is configured.
 *
 * Deliberately separate from `ai.ts`: that module carries a `server-only` guard
 * so a key can never be dragged into a client bundle, but this half is pure
 * environment reading with no secret in its return value, and pages and tests
 * both need to ask "is the feature available?".
 *
 * The key itself is read here and never returned, logged or stored.
 */

export type Provider = "anthropic" | "openai";

export interface AiConfig {
  provider: Provider;
  modelId: string;
}

const DEFAULTS: Record<Provider, string> = {
  anthropic: "claude-sonnet-4-5",
  openai: "gpt-4.1-mini",
};

export function keyFor(provider: Provider): string | undefined {
  const key =
    provider === "anthropic" ? process.env.ANTHROPIC_API_KEY : process.env.OPENAI_API_KEY;
  return key && key.trim().length > 0 ? key : undefined;
}

/**
 * `ASOF_AI_MODEL=anthropic:claude-sonnet-4-5`. With only a key set and no model
 * named, a sensible default for that provider is used. Naming a provider whose
 * key is missing disables the feature rather than falling through to the other
 * one — a surprise provider is worse than no provider.
 */
export function aiConfig(): AiConfig | null {
  const raw = process.env.ASOF_AI_MODEL?.trim();
  if (raw) {
    const [maybeProvider, ...rest] = raw.split(":");
    const provider = maybeProvider as Provider;
    if (provider !== "anthropic" && provider !== "openai") return null;
    if (!keyFor(provider)) return null;
    return { provider, modelId: rest.join(":") || DEFAULTS[provider] };
  }
  for (const provider of ["anthropic", "openai"] as Provider[]) {
    if (keyFor(provider)) return { provider, modelId: DEFAULTS[provider] };
  }
  return null;
}

export function aiEnabled(): boolean {
  return aiConfig() !== null;
}

/** For the UI to be honest about what read a document. */
export function aiLabel(): string | null {
  const cfg = aiConfig();
  return cfg ? `${cfg.provider}/${cfg.modelId}` : null;
}
