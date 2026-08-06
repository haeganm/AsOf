/**
 * The shape every server action returns.
 *
 * Validation used to `throw`, which in dev shows the Next.js overlay and in
 * production shows a blank error boundary — either way the user loses ten
 * minutes of writing. The rules were right; only the delivery was wrong. Now a
 * broken rule comes back as state, the form re-renders with its values intact
 * (the inputs are uncontrolled, so React never resets them), and the message is
 * shown next to the submit button.
 */
export interface ActionState {
  error: string | null;
  /**
   * Everything the user submitted, echoed back so the form can restore itself.
   *
   * The fields are server-rendered, so their `defaultValue` is whatever the
   * server sent — React will not repopulate them from a failed submission on its
   * own, and the form came back blank. This is the user's own input travelling
   * back to the user's own screen; nothing else is added to it.
   */
  values?: Record<string, string | string[]>;
}

export const OK: ActionState = { error: null };

/** Serialises a submission so a rejected save can be put back on the page. */
export function echo(fd: FormData): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [k, v] of fd.entries()) {
    if (typeof v !== "string") continue;
    const existing = out[k];
    if (existing === undefined) out[k] = v;
    else if (Array.isArray(existing)) existing.push(v);
    else out[k] = [existing, v];
  }
  return out;
}

/** Turns an unknown thrown value into something worth reading. */
export function toMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return "Something went wrong saving that. Nothing was changed.";
}
