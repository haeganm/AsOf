import Link from "next/link";
import type { Decision, Evidence, TimelineEntry } from "@/lib/view-types";
import { DECISION_LABEL } from "@/lib/types";
import { money, relativeDays, shortDate, signedPct } from "@/lib/format";
import { Badge, ConfidenceMeter, VerdictMark } from "./ui";

/*
  The visual grammar, held consistent everywhere:

    FACT           solid rule, sans type, a source you could check
    MY READ        dashed rule, serif italic — the investor's own inference
    DECISION       fully boxed with an inverted header — something was done
    THESIS         boxed, version-stamped
    EVENT          diamond marker, prepared vs resolved
    SIZE           a bare ledger line, no box at all

  You should be able to tell what kind of thing you are looking at with the
  text blurred out.
*/

function Marker({ kind }: { kind: TimelineEntry["kind"] | "resolved" }) {
  const base = "absolute -left-[4px] top-[6px] block";
  switch (kind) {
    case "decision":
      return <span className={`${base} h-[7px] w-[7px] bg-ink`} />;
    case "thesis":
      return (
        <span className={`${base} h-[7px] w-[7px] border border-ink bg-paper ring-2 ring-paper`} />
      );
    case "evidence":
      return <span className={`${base} h-[7px] w-[7px] rounded-full bg-ink-3`} />;
    case "event":
      return <span className={`${base} h-[7px] w-[7px] rotate-45 border border-ink bg-paper`} />;
    case "resolved":
      return <span className={`${base} h-[7px] w-[7px] rotate-45 bg-ink`} />;
    case "postmortem":
      return (
        <span
          className={`${base} h-[9px] w-[9px] -left-[5px] rounded-full border border-ink bg-paper`}
        />
      );
    default:
      return <span className={`${base} top-[9px] h-[1px] w-[9px] -left-[5px] bg-rule-2`} />;
  }
}

export function EvidenceBlock({
  e,
  assumptionText,
}: {
  e: Evidence;
  assumptionText?: string | null;
}) {
  const isRead = e.kind === "interpretation";
  return (
    <div className={`border-l-2 pl-4 ${isRead ? "border-dashed border-ink-4" : "border-ink"}`}>
      <div className="mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="label label-ink">{isRead ? "My read" : "Fact"}</span>
        {e.source && <span className="text-[11px] text-ink-3">{e.source}</span>}
      </div>
      <p className={`text-[14px] font-medium leading-snug ${isRead ? "font-serif italic" : ""}`}>
        {e.title}
      </p>
      {e.body && (
        <p className={`mt-2 text-[13.5px] leading-relaxed text-ink-2 ${isRead ? "writing italic" : ""}`}>
          {e.body}
        </p>
      )}
      {e.contradictsAssumptionId && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Badge variant="outline">Stands against</Badge>
          <span className="text-[12px] italic text-ink-3">
            {assumptionText ?? e.contradictsAssumptionId}
          </span>
        </div>
      )}
    </div>
  );
}

export function DecisionBlock({
  d,
  href,
  compact = false,
}: {
  d: Decision;
  href?: string;
  compact?: boolean;
}) {
  return (
    <div className="border border-ink">
      <div className="sealed flex items-center justify-between gap-4 px-3 py-[7px]">
        <span className="label label-ink text-paper!">{DECISION_LABEL[d.type]}</span>
        <span className="num text-[10.5px] tracking-wide">{shortDate(d.occurredAt)}</span>
      </div>
      <div className="px-4 py-4">
        <p className="text-[14.5px] font-medium leading-snug">
          {href ? (
            <Link href={href} className="link">
              {d.what}
            </Link>
          ) : (
            d.what
          )}
        </p>
        {!compact && (
          <>
            <p className="writing mt-3 text-[14px]">{d.why}</p>
            <dl className="mt-4 grid gap-x-8 gap-y-3 border-t border-rule pt-4 sm:grid-cols-2">
              {d.expectation && (
                <div>
                  <dt className="label mb-1">Expected</dt>
                  <dd className="text-[13px] leading-relaxed text-ink-2">{d.expectation}</dd>
                </div>
              )}
              {d.mainRisk && (
                <div>
                  <dt className="label mb-1">Main risk</dt>
                  <dd className="text-[13px] leading-relaxed text-ink-2">{d.mainRisk}</dd>
                </div>
              )}
              {d.reversalTrigger && (
                <div className="sm:col-span-2">
                  <dt className="label mb-1">Would reverse if</dt>
                  <dd className="text-[13px] leading-relaxed text-ink-2">{d.reversalTrigger}</dd>
                </div>
              )}
            </dl>
          </>
        )}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-rule pt-3">
          <ConfidenceMeter value={d.confidence} label="Confidence at the time" />
          {d.outcomeVerdict ? (
            <VerdictMark value={d.outcomeVerdict} />
          ) : (
            <Badge variant="quiet">Outcome not recorded</Badge>
          )}
        </div>
        {!compact && d.outcomeNote && (
          <div className="mt-3 bg-wash px-3 py-3">
            <div className="label mb-1.5">Looking back</div>
            <p className="writing text-[13.5px]">{d.outcomeNote}</p>
          </div>
        )}
      </div>
    </div>
  );
}

export function TimelineFeed({
  entries,
  assumptionText,
  emptyNote = "Nothing recorded in this window.",
}: {
  entries: TimelineEntry[];
  /** Resolves an assumption id to its text, so contradictions read in plain English. */
  assumptionText?: (id: string) => string | null;
  emptyNote?: string;
}) {
  if (entries.length === 0) {
    return <p className="py-6 text-[13px] text-ink-4">{emptyNote}</p>;
  }
  return (
    <ol>
      {entries.map((entry, i) => (
        <li key={`${entry.kind}-${entry.at}-${i}`} className="grid grid-cols-[76px_1fr] sm:grid-cols-[104px_1fr]">
          <div className="pr-4 pt-[1px] text-right">
            <div className="num text-[11px] text-ink-2">{shortDate(entry.at)}</div>
            <div className="text-[10px] text-ink-4">{relativeDays(entry.at)}</div>
          </div>
          <div className="relative border-l border-rule pb-9 pl-6">
            <Marker kind={entry.kind === "event" && entry.phase === "resolved" ? "resolved" : entry.kind} />
            <TimelineBody entry={entry} assumptionText={assumptionText} />
          </div>
        </li>
      ))}
    </ol>
  );
}

function TimelineBody({
  entry,
  assumptionText,
}: {
  entry: TimelineEntry;
  assumptionText?: (id: string) => string | null;
}) {
  switch (entry.kind) {
    case "evidence":
      return (
        <EvidenceBlock
          e={entry.data}
          assumptionText={
            entry.data.contradictsAssumptionId && assumptionText
              ? assumptionText(entry.data.contradictsAssumptionId)
              : null
          }
        />
      );

    case "decision":
      return <DecisionBlock d={entry.data} href={`/decisions/${entry.data.id}`} compact />;

    case "thesis": {
      const t = entry.data;
      return (
        <div className="border border-rule-2 bg-wash">
          <div className="flex items-center gap-3 border-b border-rule px-3 py-2">
            <span className="num flex h-[18px] min-w-[24px] items-center justify-center bg-ink px-1 text-[10px] font-medium text-paper">
              v{t.versionNo}
            </span>
            <span className="label label-ink">
              {t.versionNo === 1 ? "Thesis written" : "Thesis updated"}
            </span>
            <ConfidenceMeter value={t.confidence} showValue={false} />
          </div>
          <div className="px-4 py-3.5">
            <p className="writing text-[14.5px]">{t.summary}</p>
            {t.changeNote && (
              <p className="mt-3 border-t border-rule pt-3 text-[13px] leading-relaxed text-ink-2">
                <span className="label mr-2">What changed</span>
                {t.changeNote}
              </p>
            )}
          </div>
        </div>
      );
    }

    case "event": {
      const ev = entry.data;
      const resolved = entry.phase === "resolved" && ev.outcome;
      return (
        <div className="border border-rule-2">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rule px-3 py-2">
            <span className="label label-ink">
              Event · {resolved ? "Resolved" : "Prepared"}
            </span>
            <span className="text-[11px] text-ink-3">
              {resolved ? "Outcome recorded" : `Happens ${relativeDays(ev.occurredAt, entry.at)}`}
            </span>
          </div>
          <div className="px-4 py-3.5">
            <p className="text-[14px] font-medium">
              <Link href={`/events/${ev.id}`} className="link">
                {ev.title}
              </Link>
            </p>
            <p className="writing mt-2 text-[13.5px]">
              {resolved ? ev.outcome!.whatHappened : ev.iExpect}
            </p>
            {resolved && (
              <div className="mt-3 flex flex-wrap gap-2 border-t border-rule pt-3">
                <span className="label mr-1 pt-[3px]">Forecast</span>
                <VerdictMark value={ev.outcome!.forecastAccurate} />
                <span className="label mr-1 ml-2 pt-[3px]">Followed plan</span>
                <VerdictMark value={ev.outcome!.followedPlan} />
              </div>
            )}
          </div>
        </div>
      );
    }

    case "lot": {
      const l = entry.data;
      const buy = l.deltaShares > 0;
      return (
        <div className="py-[1px]">
          <p className="num text-[12.5px] text-ink-2">
            {buy ? "+" : "−"}
            {Math.abs(l.deltaShares).toLocaleString()} sh @ {money(l.price, { cents: true })}
            <span className="ml-2 text-ink-4">
              · {money(Math.abs(l.deltaShares * l.price))} {buy ? "bought" : "sold"}
            </span>
          </p>
          {l.note && <p className="mt-1 text-[12px] italic text-ink-3">{l.note}</p>}
        </div>
      );
    }

    case "postmortem": {
      const pm = entry.data;
      return (
        <div className="border border-ink border-t-[3px]">
          <div className="px-4 py-4">
            <div className="label label-ink mb-2">Postmortem</div>
            <p className="writing-lg text-[16px]">{pm.lesson}</p>
            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-rule pt-3">
              <span className="label mr-1">Thesis</span>
              <VerdictMark value={pm.verdicts.thesisCorrect} />
              <span className="label mr-1 ml-2">Process</span>
              <VerdictMark value={pm.verdicts.followedProcess} />
              <span className="label mr-1 ml-2">Driven by</span>
              <VerdictMark value={pm.verdicts.drivenBy} />
            </div>
            <Link href={`/postmortems/${pm.id}`} className="link mt-3 inline-block text-[12.5px]">
              Read the full postmortem
            </Link>
          </div>
        </div>
      );
    }
  }
}

/** Sparkline for a price path. Inline SVG — no chart library. */
export function Spark({
  points,
  at,
  width = 220,
  height = 44,
  markLast = true,
}: {
  points: number[];
  /** Optional timestamps, one per point. Given these, x is time — not index. */
  at?: string[];
  width?: number;
  height?: number;
  markLast?: boolean;
}) {
  const clean = points.filter((p) => Number.isFinite(p));
  if (clean.length < 2 || clean.length !== points.length) return null;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min;

  // Marks are not evenly spaced in time — the demo book has 50-day early gaps and
  // 26-day recent ones — so an index axis distorts the shape.
  const ts = at?.length === points.length ? at.map((s) => new Date(s).getTime()) : null;
  const t0 = ts ? ts[0] : 0;
  const tSpan = ts ? ts[ts.length - 1] - t0 : 0;
  const x = (i: number) =>
    (ts && tSpan > 0 ? (ts[i] - t0) / tSpan : i / (points.length - 1)) * (width - 2) + 1;
  // A flat series sits on the centre line; pinning it to the floor read as a collapse.
  const y = (v: number) =>
    span === 0 ? height / 2 : height - 3 - ((v - min) / span) * (height - 6);

  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(p).toFixed(1)}`)
    .join(" ");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
      <path d={path} fill="none" stroke="#0f0f0e" strokeWidth="1.25" />
      {markLast && (
        <circle cx={x(points.length - 1)} cy={y(points[points.length - 1])} r="2.5" fill="#0f0f0e" />
      )}
    </svg>
  );
}

// ponytail: ChangeNote removed — it was exported, never rendered, and divided by
// `from` with no zero guard. Re-add it the day something actually needs it.
