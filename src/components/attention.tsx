import Link from "next/link";
import type { AttentionItem } from "@/lib/view-types";
import { Empty } from "./ui";

const SEVERITY: Record<AttentionItem["severity"], { glyph: string; label: string }> = {
  high: { glyph: "▰", label: "Act or decide not to" },
  medium: { glyph: "▨", label: "Worth a look" },
  low: { glyph: "▱", label: "Background" },
};

/**
 * The engine never rules on whether a thesis is right. Every item states the
 * tension in facts and closes with a question — the judgment stays with the user.
 */
export function AttentionQueue({ items, limit }: { items: AttentionItem[]; limit?: number }) {
  const shown = limit ? items.slice(0, limit) : items;

  if (shown.length === 0) {
    return (
      <Empty
        title="Nothing is in tension right now"
        body="No evidence sits against an unreviewed assumption, no catalyst has passed without an outcome, and nothing has gone quiet. This is the empty state you want."
      />
    );
  }

  return (
    <>
      <ol className="divide-y divide-rule border-y border-rule">
        {shown.map((item) => (
          <li key={item.id}>
            <Link href={item.href} className="group block py-5 transition-colors hover:bg-wash/70">
              <div className="grid grid-cols-[20px_1fr] gap-4">
                <span
                  className="num pt-[2px] text-[12px] text-ink"
                  title={SEVERITY[item.severity].label}
                >
                  {SEVERITY[item.severity].glyph}
                </span>
                <div className="min-w-0">
                  <div className="label mb-1.5">{item.kind}</div>
                  <p className="text-[15px] font-medium leading-snug text-ink group-hover:underline group-hover:decoration-rule-2 group-hover:underline-offset-4">
                    {item.headline}
                  </p>
                  <p className="mt-2 max-w-[76ch] text-[13px] leading-relaxed text-ink-2">
                    {item.detail}
                  </p>
                  <p className="mt-3 border-l-2 border-ink pl-3 font-serif text-[14px] italic leading-relaxed text-ink">
                    {item.question}
                  </p>
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ol>
      {limit && items.length > limit && (
        <p className="mt-3 text-[12px] text-ink-3">
          {items.length - limit} further item{items.length - limit === 1 ? "" : "s"} of lower
          severity not shown here.
        </p>
      )}
    </>
  );
}
