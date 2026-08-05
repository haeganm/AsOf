import Link from "next/link";
import { notFound } from "next/navigation";
import { recordDecisionOutcome } from "@/lib/actions";
import {
  getDecision,
  getEvent,
  getPositionSnapshot,
  getThesisAt,
  justBefore,
  listReplayAttempts,
} from "@/lib/queries";
import { DECISION_LABEL } from "@/lib/types";
import { money, relativeDays, shortDate, signedPct } from "@/lib/format";
import { ChipRadio, Prose } from "@/components/forms";
import { Badge, ConfidenceMeter, Field, PageHeader, Section, VerdictMark } from "@/components/ui";

export default async function DecisionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = getDecision(id);
  if (!d) notFound();

  const position = d.positionId ? getPositionSnapshot(d.positionId) : null;
  // The thesis as it stood when the decision was taken, not as it reads now.
  const thesisThen = d.positionId ? getThesisAt(d.positionId, justBefore(d.occurredAt)) : null;
  const thesisNow = d.positionId ? getThesisAt(d.positionId) : null;
  const event = d.linkedEventId ? getEvent(d.linkedEventId) : null;
  const attempts = listReplayAttempts(id);

  return (
    <>
      <PageHeader
        eyebrow={
          <span className="flex flex-wrap items-center gap-2">
            <span>{DECISION_LABEL[d.type]}</span>
            <span className="text-ink-4">·</span>
            <span>
              {shortDate(d.occurredAt)} — {relativeDays(d.occurredAt)}
            </span>
            {position && (
              <>
                <span className="text-ink-4">·</span>
                <Link href={`/positions/${position.id}`} className="link num">
                  {position.ticker}
                </Link>
              </>
            )}
          </span>
        }
        title={d.what}
        actions={
          <Link href={`/replay/${d.id}`} className="btn btn-solid">
            Replay this decision
          </Link>
        }
      />

      <div className="grid gap-x-12 gap-y-10 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="min-w-0">
          <Section label="Reasoning at the time">
            <p className="writing-lg">{d.why}</p>
            <div className="mt-8">
              <Field label="Expected">{d.expectation ?? "Nothing recorded."}</Field>
              <Field label="Main risk">{d.mainRisk ?? "Nothing recorded."}</Field>
              <Field label="Would reverse if">{d.reversalTrigger ?? "Nothing recorded."}</Field>
              <Field label="Confidence" serif={false}>
                <ConfidenceMeter value={d.confidence} />
              </Field>
            </div>
          </Section>

          {thesisThen && (
            <Section
              label="The thesis this rested on"
              title={`v${thesisThen.versionNo}, in force on the day`}
              aside={
                thesisNow && thesisNow.versionNo !== thesisThen.versionNo ? (
                  <span>Now at v{thesisNow.versionNo}</span>
                ) : undefined
              }
            >
              <p className="writing">{thesisThen.summary}</p>
              <ul className="mt-5 divide-y divide-rule border-y border-rule">
                {thesisThen.assumptions.map((a) => (
                  <li key={a.id} className="flex items-baseline gap-3 py-2.5">
                    <span className="num shrink-0 text-[10.5px] text-ink-4">{a.id}</span>
                    <span className="flex-1 text-[13px] text-ink-2">{a.text}</span>
                    {a.status !== "intact" && <Badge variant="dashed">{a.status}</Badge>}
                  </li>
                ))}
              </ul>
              {thesisNow && thesisNow.versionNo !== thesisThen.versionNo && (
                <p className="mt-4 border-l-2 border-ink pl-4 text-[13px] leading-relaxed text-ink-2">
                  The thesis has been rewritten {thesisNow.versionNo - thesisThen.versionNo} time
                  {thesisNow.versionNo - thesisThen.versionNo === 1 ? "" : "s"} since this decision.
                  Judge the decision against the version above, not the current one.
                </p>
              )}
            </Section>
          )}

          <Section label="Outcome" title={d.outcomeVerdict ? `Recorded ${shortDate(d.outcomeAt!)}` : "Not yet judged"}>
            {d.outcomeVerdict ? (
              <>
                <div className="mb-5 flex items-center gap-3">
                  <span className="label">Your verdict</span>
                  <VerdictMark value={d.outcomeVerdict} />
                </div>
                <p className="writing">{d.outcomeNote}</p>
              </>
            ) : (
              <form action={recordDecisionOutcome} className="max-w-[640px]">
                <input type="hidden" name="decisionId" value={id} />
                <p className="writing mb-6 text-[14px]">
                  Judging the decision is not the same as reading the price. A decision can be good
                  and lose money. Write what you would tell a colleague who asked whether you would
                  do it again.
                </p>
                <div className="space-y-6">
                  <ChipRadio
                    label="On its own terms, did this decision work?"
                    name="outcomeVerdict"
                    defaultValue="mixed"
                    options={[
                      { value: "worked", label: "Worked" },
                      { value: "mixed", label: "Mixed" },
                      { value: "did_not_work", label: "Did not work" },
                    ]}
                  />
                  <Prose
                    label="What happened, and what it tells you"
                    name="outcomeNote"
                    required
                    rows={5}
                    placeholder="Be specific about whether the reasoning held, separately from whether the price cooperated."
                  />
                  <button type="submit" className="btn btn-solid">
                    Record the outcome
                  </button>
                </div>
              </form>
            )}
          </Section>

          {attempts.length > 0 && (
            <Section label="Replay attempts" title={`You have re-decided this ${attempts.length} time${attempts.length === 1 ? "" : "s"}`}>
              <ul className="space-y-4">
                {attempts.map((a) => (
                  <li key={a.id} className="border border-rule px-4 py-4">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="num text-[11px] text-ink-3">{shortDate(a.createdAt)}</span>
                      <Badge variant={a.newChoice === d.type ? "quiet" : "solid"}>
                        {a.newChoice === d.type
                          ? `Same call — ${DECISION_LABEL[a.newChoice]}`
                          : `${DECISION_LABEL[d.type]} → ${DECISION_LABEL[a.newChoice]}`}
                      </Badge>
                      <ConfidenceMeter value={a.newConfidence} showValue={false} />
                    </div>
                    <p className="writing mt-3 text-[13.5px]">{a.newReasoning}</p>
                  </li>
                ))}
              </ul>
              <Link href={`/replay/${d.id}`} className="link mt-4 inline-block text-[13px]">
                Replay it again
              </Link>
            </Section>
          )}
        </div>

        <aside className="space-y-8 lg:sticky lg:top-8 lg:self-start">
          {position && (
            <div>
              <div className="label label-ink mb-3 border-b border-rule pb-2">Position now</div>
              <dl className="space-y-2.5 text-[12.5px]">
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-3">Size</dt>
                  <dd className="num">
                    {position.shares > 0.0001 ? `${position.shares.toLocaleString()} sh` : "Closed"}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-3">Mark</dt>
                  <dd className="num">
                    {position.price !== null ? money(position.price, { cents: true }) : "—"}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-3">Return on cost</dt>
                  <dd className="num">{signedPct(position.returnPct)}</dd>
                </div>
              </dl>
              <Link href={`/positions/${position.id}`} className="link mt-4 inline-block text-[12.5px]">
                Open the position
              </Link>
            </div>
          )}

          {event && (
            <div>
              <div className="label label-ink mb-3 border-b border-rule pb-2">Tied to</div>
              <Link href={`/events/${event.id}`} className="link text-[13px] leading-snug">
                {event.title}
              </Link>
              <p className="num mt-1 text-[11px] text-ink-3">{shortDate(event.occurredAt)}</p>
              {event.outcome && (
                <p className="mt-3 text-[12px] leading-relaxed text-ink-2">
                  {event.outcome.whatHappened.slice(0, 180)}…
                </p>
              )}
            </div>
          )}
        </aside>
      </div>
    </>
  );
}
