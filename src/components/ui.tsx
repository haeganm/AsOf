import Link from "next/link";
import type { ReactNode } from "react";
import type { Assumption, VerdictValue } from "@/lib/view-types";
import { VERDICT_LABEL } from "@/lib/format";

export function PageHeader({
  eyebrow,
  title,
  lede,
  actions,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  lede?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="border-b border-rule pb-7 mb-9">
      <div className="flex items-start justify-between gap-8">
        <div className="min-w-0">
          {eyebrow && <div className="label mb-3">{eyebrow}</div>}
          <h1 className="display text-[30px] leading-[1.15]">{title}</h1>
          {lede && <p className="writing mt-4 text-[15px]">{lede}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2 pt-1">{actions}</div>}
      </div>
    </header>
  );
}

export function Section({
  label,
  title,
  aside,
  children,
  className = "",
}: {
  label?: ReactNode;
  title?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`mb-12 ${className}`}>
      {(label || title || aside) && (
        <div className="mb-4 flex items-baseline justify-between gap-6 border-b border-rule pb-2">
          <div className="flex items-baseline gap-3">
            {label && <span className="label label-ink">{label}</span>}
            {title && <span className="text-[13px] text-ink-3">{title}</span>}
          </div>
          {aside && <div className="text-[12px] text-ink-3">{aside}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Card({
  children,
  className = "",
  as: As = "div",
}: {
  children: ReactNode;
  className?: string;
  as?: "div" | "article" | "li";
}) {
  return <As className={`border border-rule bg-paper ${className}`}>{children}</As>;
}

export function Badge({
  children,
  variant = "outline",
  title,
}: {
  children: ReactNode;
  variant?: "solid" | "outline" | "quiet" | "dashed";
  title?: string;
}) {
  const styles = {
    solid: "bg-ink text-paper border-ink",
    outline: "border-ink text-ink",
    quiet: "border-rule-2 text-ink-3",
    dashed: "border-dashed border-ink-3 text-ink-2",
  }[variant];
  return (
    <span
      title={title}
      data-badge={variant}
      className={`inline-flex items-center border px-1.5 py-[2px] text-[10px] font-medium uppercase tracking-[0.1em] ${styles}`}
    >
      {children}
    </span>
  );
}

export function ConfidenceMeter({
  value,
  max = 5,
  showValue = true,
  label,
}: {
  value: number | null;
  max?: number;
  showValue?: boolean;
  label?: string;
}) {
  if (value === null) return <span className="text-ink-4">—</span>;
  return (
    <span className="inline-flex items-center gap-2" title={`Confidence ${value} of ${max}`}>
      {label && <span className="label">{label}</span>}
      <span className="inline-flex gap-[3px]">
        {Array.from({ length: max }, (_, i) => (
          <span
            key={i}
            className={`block h-[9px] w-[9px] border border-ink ${i < value ? "bg-ink" : ""}`}
          />
        ))}
      </span>
      {showValue && <span className="num text-[11px] text-ink-3">{value}/{max}</span>}
    </span>
  );
}

export function Bar({
  pct,
  tone = "ink",
  height = 6,
}: {
  pct: number;
  tone?: "ink" | "mid" | "light";
  height?: number;
}) {
  const bg = { ink: "#0f0f0e", mid: "#8a8a85", light: "#c9c9c5" }[tone];
  return (
    <span className="block w-full bg-wash-2" style={{ height }}>
      <span
        className="block"
        style={{ width: `${Math.max(0, Math.min(100, pct))}%`, height, background: bg }}
      />
    </span>
  );
}

export function Stat({
  label,
  value,
  sub,
  className = "",
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="label mb-1.5">{label}</div>
      <div className="num text-[20px] leading-none text-ink">{value}</div>
      {sub && <div className="mt-1.5 text-[11.5px] text-ink-3">{sub}</div>}
    </div>
  );
}

export function Empty({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="border border-dashed border-rule-2 px-6 py-10 text-center">
      <p className="display text-[16px]">{title}</p>
      <p className="writing mx-auto mt-2 text-[13.5px]">{body}</p>
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

/** Definition row used across thesis, decision and event detail. */
export function Field({
  label,
  children,
  serif = true,
  stacked = false,
}: {
  label: ReactNode;
  children: ReactNode;
  serif?: boolean;
  /** Label above rather than beside — for use inside narrow columns. */
  stacked?: boolean;
}) {
  return (
    <div
      className={`border-t border-rule py-4 first:border-t-0 first:pt-0 ${
        stacked ? "" : "sm:grid sm:grid-cols-[168px_1fr] sm:gap-8"
      }`}
    >
      <div className="label pt-[3px]">{label}</div>
      <div
        className={`mt-1.5 ${stacked ? "" : "sm:mt-0"} ${
          serif ? "writing" : "text-[13.5px] text-ink-2"
        }`}
      >
        {children}
      </div>
    </div>
  );
}

const ASSUMPTION_MARK: Record<Assumption["status"], { mark: string; label: string; cls: string }> = {
  intact: { mark: "▰", label: "Intact", cls: "text-ink" },
  weakening: { mark: "▱", label: "Weakening", cls: "text-ink-2" },
  broken: { mark: "✕", label: "Broken", cls: "text-ink" },
};

export function AssumptionList({
  assumptions,
  contradictedIds = [],
}: {
  assumptions: Assumption[];
  contradictedIds?: string[];
}) {
  if (assumptions.length === 0) return <p className="text-[13px] text-ink-4">None recorded.</p>;
  return (
    <ol className="divide-y divide-rule border-y border-rule">
      {assumptions.map((a) => {
        const m = ASSUMPTION_MARK[a.status];
        const flagged = contradictedIds.includes(a.id);
        return (
          <li key={a.id} className="flex items-start gap-4 py-3">
            <span className={`num shrink-0 pt-[3px] text-[11px] ${m.cls}`} title={m.label}>
              {m.mark}
            </span>
            <div className="min-w-0 flex-1">
              <p
                className={`text-[13.5px] leading-relaxed ${
                  a.status === "broken" ? "text-ink-3 line-through" : "text-ink-2"
                }`}
              >
                {a.text}
              </p>
              {(a.status !== "intact" || flagged) && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {a.status !== "intact" && (
                    <Badge variant={a.status === "broken" ? "solid" : "dashed"}>{m.label}</Badge>
                  )}
                  {flagged && <Badge variant="outline">Evidence against</Badge>}
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function BulletList({ items, marker = "—" }: { items: string[]; marker?: string }) {
  if (items.length === 0) return <span className="text-ink-4">None recorded.</span>;
  return (
    <ul className="space-y-2">
      {items.map((t, i) => (
        <li key={i} className="flex gap-3">
          <span className="shrink-0 text-ink-4">{marker}</span>
          <span>{t}</span>
        </li>
      ))}
    </ul>
  );
}

export function VerdictMark({ value }: { value: VerdictValue | string }) {
  const map: Record<string, { glyph: string; variant: "solid" | "outline" | "dashed" | "quiet" }> = {
    yes: { glyph: "Yes", variant: "solid" },
    partly: { glyph: "Partly", variant: "dashed" },
    no: { glyph: "No", variant: "outline" },
    worked: { glyph: "Worked", variant: "solid" },
    mixed: { glyph: "Mixed", variant: "dashed" },
    did_not_work: { glyph: "Did not work", variant: "outline" },
  };
  const m = map[value] ?? { glyph: VERDICT_LABEL[value] ?? value, variant: "quiet" as const };
  return <Badge variant={m.variant}>{m.glyph}</Badge>;
}

export function ButtonLink({
  href,
  children,
  variant = "quiet",
}: {
  href: string;
  children: ReactNode;
  variant?: "solid" | "default" | "quiet";
}) {
  const cls = variant === "solid" ? "btn btn-solid" : variant === "quiet" ? "btn btn-quiet" : "btn";
  return (
    <Link href={href} className={cls}>
      {children}
    </Link>
  );
}
