import Link from "next/link";
import { getCalibration, getPatterns, listDecisions, listEvents } from "@/lib/queries";
import { DECISION_LABEL } from "@/lib/types";
import { pct, shortDate } from "@/lib/format";
import { Badge, ConfidenceMeter, Empty, PageHeader, Section, VerdictMark } from "@/components/ui";

/** Stated confidence against how those decisions actually resolved. Inline SVG. */
function Calibration({ buckets }: { buckets: ReturnType<typeof getCalibration> }) {
  const W = 560;
  const H = 250;
  const pad = { l: 46, r: 18, t: 16, b: 42 };
  const x = (c: number) => pad.l + ((c - 1) / 4) * (W - pad.l - pad.r);
  const y = (p: number) => H - pad.b - (p / 100) * (H - pad.t - pad.b);
  const maxCount = Math.max(...buckets.map((b) => b.count), 1);

  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-[560px]" role="img" aria-label="Stated confidence against realised outcomes">
        {[0, 25, 50, 75, 100].map((p) => (
          <g key={p}>
            <line x1={pad.l} x2={W - pad.r} y1={y(p)} y2={y(p)} stroke="#e3e3e0" strokeWidth="1" />
            <text x={pad.l - 8} y={y(p) + 3.5} textAnchor="end" fontSize="9.5" fill="#9b9b95" fontFamily="ui-monospace, monospace">
              {p}%
            </text>
          </g>
        ))}

        {/* A perfectly ordered 1–5 scale, drawn as a convention rather than a law. */}
        <line
          x1={x(1)}
          y1={y(20)}
          x2={x(5)}
          y2={y(100)}
          stroke="#c9c9c5"
          strokeWidth="1"
          strokeDasharray="3 3"
        />
        <text x={x(4.1)} y={y(84)} fontSize="9" fill="#9b9b95" fontStyle="italic">
          an evenly ordered scale
        </text>

        {[1, 2, 3, 4, 5].map((c) => (
          <text key={c} x={x(c)} y={H - pad.b + 16} textAnchor="middle" fontSize="10" fill="#6d6d68" fontFamily="ui-monospace, monospace">
            {c}
          </text>
        ))}
        <text x={(pad.l + W - pad.r) / 2} y={H - 6} textAnchor="middle" fontSize="9.5" fill="#9b9b95" letterSpacing="1.4">
          STATED CONFIDENCE
        </text>

        <line x1={pad.l} x2={pad.l} y1={pad.t} y2={H - pad.b} stroke="#c9c9c5" />
        <line x1={pad.l} x2={W - pad.r} y1={H - pad.b} y2={H - pad.b} stroke="#c9c9c5" />

        {buckets.length > 1 && (
          <polyline
            points={buckets.map((b) => `${x(b.confidence)},${y(b.realisedPct)}`).join(" ")}
            fill="none"
            stroke="#0f0f0e"
            strokeWidth="1.25"
          />
        )}
        {buckets.map((b) => (
          <g key={b.confidence}>
            <circle
              cx={x(b.confidence)}
              cy={y(b.realisedPct)}
              r={4 + (b.count / maxCount) * 5}
              fill="#0f0f0e"
            />
            <text
              x={x(b.confidence)}
              /* Flip the label below the dot near the top, or it clips out of frame. */
              y={b.realisedPct > 86 ? y(b.realisedPct) + 18 : y(b.realisedPct) - 12}
              textAnchor="middle"
              fontSize="9.5"
              fill="#3c3c39"
              fontFamily="ui-monospace, monospace"
            >
              {Math.round(b.realisedPct)}%
            </text>
          </g>
        ))}
      </svg>
      <figcaption className="mt-3 max-w-[62ch] text-[11.5px] leading-relaxed text-ink-3">
        Dot size is the number of decisions in that bucket. A decision you judged “mixed” counts as
        half. The dashed line is only a convention for what an evenly ordered scale would look like —
        what matters is whether your dots rise from left to right at all.
      </figcaption>
    </figure>
  );
}

export default function PatternsPage() {
  const buckets = getCalibration();
  const patterns = getPatterns();
  const decisions = listDecisions();
  const resolved = decisions.filter((d) => d.outcomeVerdict);
  const resolvedEvents = listEvents().filter((e) => e.outcome);

  return (
    <>
      <PageHeader
        eyebrow="Patterns"
        title="What you keep doing"
        lede="Nothing here is generic advice. Every claim below is computed from your own closed loops, and each one names the decisions it came from so you can disagree with it."
      />

      {resolved.length < 3 ? (
        <Empty
          title="Not enough closed loops yet"
          body={`${resolved.length} of ${decisions.length} decisions have a recorded outcome. Patterns need at least a handful before they mean anything — recording outcomes on old decisions is the fastest way to make this page useful.`}
        />
      ) : (
        <>
          <Section
            label="Calibration"
            title={`${resolved.length} decisions with a recorded outcome`}
            aside={<span>{decisions.length - resolved.length} still open</span>}
          >
            <div className="grid gap-x-12 gap-y-8 lg:grid-cols-[minmax(0,560px)_1fr]">
              <Calibration buckets={buckets} />
              <div>
                <ul className="divide-y divide-rule border-y border-rule">
                  {buckets.map((b) => (
                    <li key={b.confidence} className="py-3">
                      <div className="flex items-center justify-between gap-4">
                        <ConfidenceMeter value={b.confidence} showValue={false} />
                        <span className="num text-[12px] text-ink-2">
                          {b.worked}W · {b.mixed}M · {b.failed}L
                        </span>
                        <span className="num w-[46px] text-right text-[12.5px]">
                          {Math.round(b.realisedPct)}%
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
                <p className="writing mt-5 text-[13px]">
                  Read this as a question rather than a score: when you write 4 or 5, does anything
                  measurable change? On this record, the honest answer is what the dots show.
                </p>
              </div>
            </div>
          </Section>

          <Section label="Patterns" title={`${patterns.length} fired on this history`}>
            <ul className="space-y-8">
              {patterns.map((p) => (
                <li key={p.id} className="border border-rule">
                  <div className="border-b border-rule px-5 py-4">
                    <h3 className="display text-[19px] leading-snug">{p.title}</h3>
                  </div>
                  <div className="px-5 py-5">
                    <p className="writing text-[14.5px]">{p.finding}</p>
                    <div className="mt-5 border-l-2 border-ink pl-4">
                      <div className="label mb-1.5">So what</div>
                      <p className="writing text-[14px]">{p.soWhat}</p>
                    </div>

                    {(p.evidence.length > 0 || (p.events?.length ?? 0) > 0) && (
                      <details className="mt-6 border-t border-rule pt-4">
                        <summary className="label label-ink cursor-pointer">
                          Built from {p.evidence.length + (p.events?.length ?? 0)} record
                          {p.evidence.length + (p.events?.length ?? 0) === 1 ? "" : "s"} — check it
                        </summary>
                        <ul className="mt-4 divide-y divide-rule border-y border-rule">
                          {p.evidence.map((d) => (
                            <li key={d.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-2.5">
                              <span className="num w-[84px] shrink-0 text-[11px] text-ink-3">
                                {shortDate(d.occurredAt)}
                              </span>
                              <Badge variant="quiet">{DECISION_LABEL[d.type]}</Badge>
                              <Link href={`/decisions/${d.id}`} className="link min-w-0 flex-1 text-[12.5px]">
                                {d.what}
                              </Link>
                              <ConfidenceMeter value={d.confidence} showValue={false} />
                              {d.outcomeVerdict && <VerdictMark value={d.outcomeVerdict} />}
                            </li>
                          ))}
                          {(p.events ?? []).map((e) => (
                            <li key={e.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-2.5">
                              <span className="num w-[84px] shrink-0 text-[11px] text-ink-3">
                                {shortDate(e.occurredAt)}
                              </span>
                              <Badge variant="quiet">Event</Badge>
                              <Link href={`/events/${e.id}`} className="link min-w-0 flex-1 text-[12.5px]">
                                {e.title}
                              </Link>
                              {e.outcome && <VerdictMark value={e.outcome.followedPlan} />}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </Section>

          <Section label="What this page cannot see" title="Stated plainly, because it changes how you should read the above">
            <ul className="writing space-y-3 text-[14px]">
              <li>
                — {decisions.length - resolved.length} of {decisions.length} decisions have no
                recorded outcome. They are absent from every calculation here, and they are unlikely
                to be a random sample.
              </li>
              <li>
                — {resolvedEvents.length} event
                {resolvedEvents.length === 1 ? " has" : "s have"} been written up after the fact.
                Anything about your forecasting rests on that number alone.
              </li>
              <li>
                — Verdicts are your own. This page measures the consistency between what you said
                beforehand and what you concluded afterwards; it cannot tell you whether either was
                right.
              </li>
              <li>
                — {pct((resolved.length / Math.max(decisions.length, 1)) * 100, 0)} loop closure. A
                pattern drawn from a handful of decisions is a hypothesis, not a finding.
              </li>
            </ul>
          </Section>
        </>
      )}
    </>
  );
}
