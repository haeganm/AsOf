"use client";

import { useEffect, useState } from "react";
import type { Nudge } from "@/lib/nudges";

/**
 * Reads the position and action out of the form as they are chosen, and shows
 * what the record already says about that combination.
 *
 * Listens to the form rather than owning the fields, so the inputs stay
 * server-rendered and uncontrolled — which is also what lets a rejected save
 * restore them.
 */
export function DecisionNudges() {
  const [nudges, setNudges] = useState<Nudge[]>([]);
  const [key, setKey] = useState("");

  useEffect(() => {
    const form = document.querySelector("form");
    if (!form) return;

    const readSelection = () => {
      const position = (form.querySelector('[name="positionId"]') as HTMLSelectElement | null)?.value ?? "";
      const type =
        (form.querySelector('input[name="type"]:checked') as HTMLInputElement | null)?.value ?? "";
      setKey(`${position}|${type}`);
    };

    readSelection();
    form.addEventListener("change", readSelection);
    return () => form.removeEventListener("change", readSelection);
  }, []);

  useEffect(() => {
    const [position, type] = key.split("|");
    if (!position || !type) {
      setNudges([]);
      return;
    }
    let live = true;
    (async () => {
      try {
        const res = await fetch(
          `/api/nudges?position=${encodeURIComponent(position)}&type=${encodeURIComponent(type)}`
        );
        const data = (await res.json()) as { nudges: Nudge[] };
        if (live) setNudges(data.nudges);
      } catch {
        if (live) setNudges([]);
      }
    })();
    return () => {
      live = false;
    };
  }, [key]);

  if (nudges.length === 0) return null;

  const stops = nudges.filter((n) => n.tone === "stop").length;

  return (
    <section className="mb-10 border border-ink">
      <div className="sealed flex flex-wrap items-baseline justify-between gap-3 px-5 py-2.5">
        <span className="label label-ink text-paper!">Before you write this down</span>
        <span className="num text-[10.5px] text-[#a8a8a2]">
          {stops > 0
            ? `${stops} of these contradict something you wrote`
            : `${nudges.length} from your own record`}
        </span>
      </div>

      <ul className="divide-y divide-rule">
        {nudges.map((n) => (
          <li key={n.id} className="grid grid-cols-[18px_1fr] gap-4 px-5 py-4">
            <span
              className="num pt-[3px] text-[12px] text-ink"
              title={
                n.tone === "stop"
                  ? "Contradicts something you wrote"
                  : n.tone === "check"
                    ? "Worth checking before you act"
                    : "Background from your record"
              }
            >
              {n.tone === "stop" ? "▰" : n.tone === "check" ? "▨" : "▱"}
            </span>
            <div className="min-w-0">
              <p className="text-[14px] font-medium leading-snug">{n.headline}</p>
              <p className="writing mt-1.5 text-[13.5px]">{n.detail}</p>
              {n.basis && <p className="label mt-2">{n.basis}</p>}
            </div>
          </li>
        ))}
      </ul>

      <p className="border-t border-rule px-5 py-3 text-[11.5px] leading-snug text-ink-3">
        None of this is advice, and none of it is a model — every line is a rule you wrote or a count
        of outcomes you judged yourself. It is here so the relevant part of your own record is
        impossible to have not read.
      </p>
    </section>
  );
}
