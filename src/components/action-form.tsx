"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef } from "react";
import type { ReactNode } from "react";
import type { ActionState } from "@/lib/action-state";

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

/**
 * Puts a rejected submission back into the form.
 *
 * The fields are server-rendered, so their `defaultValue` is whatever the server
 * last sent — React does not know about the values that were just submitted, and
 * without this the form came back blank while the banner claimed otherwise.
 */
function restore(form: HTMLFormElement, values: Record<string, string | string[]>) {
  for (const [name, value] of Object.entries(values)) {
    const nodes = form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
      `[name="${CSS.escape(name)}"]`
    );
    if (nodes.length === 0) continue;
    const wanted = Array.isArray(value) ? value : [value];

    for (const node of nodes) {
      if (node instanceof HTMLInputElement && (node.type === "radio" || node.type === "checkbox")) {
        node.checked = wanted.includes(node.value);
      } else {
        node.value = wanted[0] ?? "";
      }
    }
  }
}

/**
 * Wraps a form so a rejected save reports itself instead of throwing.
 *
 * The inputs inside are uncontrolled, which is the whole trick: React does not
 * re-create them between action states, so everything the user typed is still
 * there when the error appears. Previously a business-rule violation threw, the
 * error boundary took over, and a ten-minute thesis was gone.
 */
export function ActionForm({
  action,
  children,
  submitLabel,
  cancelHref,
  note,
  className = "max-w-[860px]",
}: {
  action: Action;
  children: ReactNode;
  submitLabel: string;
  cancelHref: string;
  note?: string;
  className?: string;
}) {
  const [state, formAction, pending] = useActionState(action, { error: null });
  const formRef = useRef<HTMLFormElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!state.error || !formRef.current) return;
    if (state.values) restore(formRef.current, state.values);
    // The submit button is sticky at the bottom, so the message is already in
    // view — but announce it for anyone who submitted by keyboard.
    errorRef.current?.focus();
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className={className} noValidate>
      {children}

      <div className="sticky bottom-0 -mx-6 mt-10 border-t border-rule bg-paper/95 px-6 py-4 backdrop-blur sm:-mx-10 sm:px-10">
        {state.error && (
          <div
            ref={errorRef}
            tabIndex={-1}
            data-form-error
            role="alert"
            aria-live="assertive"
            className="mb-4 border-l-[3px] border-ink bg-wash px-4 py-3 outline-none"
          >
            <div className="label label-ink mb-1">Not saved</div>
            <p className="text-[13.5px] leading-relaxed text-ink">{state.error}</p>
            <p className="mt-1.5 text-[12px] text-ink-3">
              Nothing was changed, and everything you wrote is still on this page.
            </p>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-4">
          <button type="submit" data-primary-submit disabled={pending} className="btn btn-solid">
            {pending ? "Saving…" : submitLabel}
          </button>
          <Link href={cancelHref} className="btn btn-quiet">
            Cancel
          </Link>
          {note && <p className="max-w-[54ch] text-[11.5px] leading-snug text-ink-3">{note}</p>}
        </div>
      </div>
    </form>
  );
}
