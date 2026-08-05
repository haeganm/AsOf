import Link from "next/link";
import { notFound } from "next/navigation";
import { recordEventOutcome } from "@/lib/actions";
import {
  eventBeliefIds,
  eventReach,
  getEvent,
  getPositionSnapshot,
  listBeliefs,
  listDecisions,
} from "@/lib/queries";
import { pct, relativeDays, shortDate } from "@/lib/format";
import { Prose, VerdictPicker } from "@/components/forms";
import { Badge, Bar, ButtonLink, Field, PageHeader, Section, VerdictMark } from "@/components/ui";

export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ev = getEvent(id);
  if (!ev) notFound();

  const position = ev.positionId ? getPositionSnapshot(ev.positionId) : null;
  const reach = eventReach(id);
  const beliefIds = eventBeliefIds(id);
  const beliefs = listBeliefs().filter((b) => beliefIds.includes(b.id));
  const linked = listDecisions().filter((d) => d.linkedEventId === id);
  const past = ev.occurredAt <= new Date().toISOString();
  const outcome = ev.outcome;

  return (
    <>
      <PageHeader
        eyebrow={
          <span className="flex flex-wrap items-center gap-2">
            <span>{ev.kind}</span>
            <span className="text-ink-4">·</span>
            <span>
              {shortDate(ev.occurredAt)} — {relativeDays(ev.occurredAt)}
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
        title={ev.title}
        lede={
          outcome
            ? undefined
            : `Plan written ${relativeDays(ev.knownAt)}. Nothing below has been revised since.`
        }
        actions={
          !outcome && position ? (
            <ButtonLink href={`/decisions/new?position=${position.id}&event=${id}`}>
              Record a decision
            </ButtonLink>
          ) : undefined
        }
      />

      {reach.length > 1 && (
        <section className="mb-11 border border-ink">
          <div className="sealed px-4 py-2.5">
            <span className="label label-ink text-paper!">
              This is not one position&rsquo;s event
            </span>
          </div>
          <div className="px-5 py-5">
            <p className="writing text-[14px]">
              Through the beliefs it tests, this event reaches{" "}
              <strong className="font-medium text-ink">{reach.length} positions</strong> —{" "}
              {pct(
                reach.reduce((s, r) => s + r.position.weightPct, 0),
                0
              )}{" "}
              of the book. A single outcome moves all of them in the same direction.
            </p>
            <ul className="mt-5 space-y-3">
              {reach.map((r) => (
                <li key={r.position.id} className="grid grid-cols-[58px_1fr_88px] items-center gap-4">
                  <Link href={`/positions/${r.position.id}`} className="num link text-[13px] font-medium">
                    {r.position.ticker}
                  </Link>
                  <Bar pct={r.position.weightPct} tone={r.position.id === ev.positionId ? "ink" : "mid"} />
                  <span className="num text-right text-[11.5px] text-ink-2">
                    {pct(r.position.weightPct)}
                  </span>
                </li>
              ))}
            </ul>
            {beliefs.length > 0 && (
              <p className="mt-5 flex flex-wrap items-center gap-2 border-t border-rule pt-4">
                <span className="label mr-1">Beliefs tested</span>
                {beliefs.map((b) => (
                  <Link key={b.id} href={`/beliefs/${b.id}`}>
                    <Badge variant="outline">{b.name}</Badge>
                  </Link>
                ))}
              </p>
            )}
          </div>
        </section>
      )}

      <div className={outcome ? "grid gap-x-12 gap-y-10 lg:grid-cols-2" : ""}>
        <div className="min-w-0">
          <Section label={outcome ? "What you wrote beforehand" : "Your preparation"}>
            <Field label="Market expects" stacked={!!outcome}>
              {ev.marketExpects ?? "Not recorded."}
            </Field>
            <Field label="You expect" stacked={!!outcome}>
              {ev.iExpect ?? "Not recorded."}
            </Field>
            <Field label="Variables that matter" stacked={!!outcome}>
              {ev.keyVariables.length === 0 ? (
                "Not recorded."
              ) : (
                <ol className="space-y-2">
                  {ev.keyVariables.map((v, i) => (
                    <li key={i} className="flex gap-3">
                      <span className="num shrink-0 text-[11px] text-ink-4">{i + 1}</span>
                      <span>{v}</span>
                    </li>
                  ))}
                </ol>
              )}
            </Field>
          </Section>

          {ev.scenarios.length > 0 && (
            <Section
              label="Scenarios"
              title="Probability, expected reaction, and the action decided in advance"
              aside={
                <span>
                  Sums to {ev.scenarios.reduce((s, x) => s + x.probability, 0)}%
                </span>
              }
            >
              <ul className="divide-y divide-rule border-y border-rule">
                {ev.scenarios.map((s) => (
                  <li key={s.name} className="py-5">
                    <div className="mb-3 grid grid-cols-[64px_1fr_44px] items-center gap-4">
                      <span className="label label-ink">{s.name}</span>
                      <Bar pct={s.probability} height={8} />
                      <span className="num text-right text-[12.5px]">{s.probability}%</span>
                    </div>
                    <dl className="space-y-3 pl-0 sm:pl-[80px]">
                      <div>
                        <dt className="label mb-1">Expected reaction</dt>
                        <dd className="text-[13px] leading-relaxed text-ink-2">{s.expectedReaction}</dd>
                      </div>
                      <div>
                        <dt className="label mb-1">Planned action</dt>
                        <dd className="writing text-[13.5px]">{s.plannedAction}</dd>
                      </div>
                    </dl>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>

        {outcome && (
          <div className="min-w-0">
            <Section label="What actually happened">
              <p className="writing-lg">{outcome.whatHappened}</p>
              {outcome.actualReaction && (
                <p className="mt-5 border-l-2 border-ink pl-4 text-[13.5px] leading-relaxed text-ink-2">
                  <span className="label mr-2">Market reaction</span>
                  {outcome.actualReaction}
                </p>
              )}
            </Section>

            <Section
              label="Read against your own plan"
              title="Not whether the price went up"
            >
              <dl className="divide-y divide-rule border-y border-rule">
                {[
                  ["Was your forecast accurate?", outcome.forecastAccurate],
                  ["Did you identify the right variables?", outcome.rightVariables],
                  ["Did you follow the plan you wrote?", outcome.followedPlan],
                  ["Was the market reaction itself a surprise?", outcome.reactionSurprising],
                ].map(([q, v]) => (
                  <div key={q as string} className="flex items-center justify-between gap-4 py-3.5">
                    <dt className="text-[13.5px] text-ink-2">{q}</dt>
                    <dd>
                      <VerdictMark value={v as string} />
                    </dd>
                  </div>
                ))}
              </dl>
              {outcome.rightVariables === "yes" && outcome.forecastAccurate !== "yes" && (
                <p className="writing mt-5 border border-rule bg-wash px-4 py-3.5 text-[13.5px]">
                  You named the variable that mattered and got its resolution wrong. Those are
                  different skills, and the first is the scarcer one — the fix is in the conditional
                  plan, not the forecast.
                </p>
              )}
              {outcome.followedPlan === "no" && (
                <p className="writing mt-4 border-l-2 border-ink pl-4 text-[13.5px]">
                  You wrote an action for this outcome and did something else. That is the most
                  expensive line on this page.
                </p>
              )}
            </Section>

            {outcome.notes && (
              <Section label="Your notes afterwards">
                <p className="writing">{outcome.notes}</p>
              </Section>
            )}
          </div>
        )}
      </div>

      {linked.length > 0 && (
        <Section label="Decisions taken around this event">
          <ul className="divide-y divide-rule border-y border-rule">
            {linked.map((d) => (
              <li key={d.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-3.5">
                <span className="num w-[86px] shrink-0 text-[11.5px] text-ink-3">
                  {shortDate(d.occurredAt)}
                </span>
                <Link href={`/decisions/${d.id}`} className="link min-w-0 flex-1 text-[13.5px]">
                  {d.what}
                </Link>
                <Link href={`/replay/${d.id}`} className="link text-[12px] text-ink-3">
                  Replay
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {!outcome && (
        <Section
          label="Record the outcome"
          title={past ? "This event has already happened" : "Available once the event has happened"}
        >
          {past ? (
            <form action={recordEventOutcome} className="max-w-[720px]">
              <input type="hidden" name="eventId" value={id} />
              <div className="space-y-7">
                <Prose
                  label="What happened"
                  name="whatHappened"
                  required
                  rows={5}
                  hint="The facts, including the ones that do not fit what you expected."
                />
                <Prose
                  label="How the market reacted"
                  name="actualReaction"
                  rows={3}
                  hint="Separate from the news itself. The reaction is its own piece of information."
                />
                <div className="grid gap-6 sm:grid-cols-2">
                  <VerdictPicker
                    label="Was your forecast accurate?"
                    name="forecastAccurate"
                    hint="About the business or the variable — not about the price."
                  />
                  <VerdictPicker
                    label="Did you identify the right variables?"
                    name="rightVariables"
                    hint="You can name the right variable and still call it wrong."
                  />
                  <VerdictPicker
                    label="Did you follow the plan you wrote?"
                    name="followedPlan"
                    hint="Answer this one honestly or the whole exercise is decorative."
                  />
                  <VerdictPicker
                    label="Was the market reaction a surprise?"
                    name="reactionSurprising"
                  />
                </div>
                <Prose
                  label="Anything worth keeping"
                  name="notes"
                  rows={4}
                  hint="The observation you would want to be handed the next time an event like this comes round."
                />
                <button type="submit" className="btn btn-solid">
                  Record the outcome
                </button>
              </div>
            </form>
          ) : (
            <p className="writing text-[13.5px]">
              Come back after {shortDate(ev.occurredAt)}. Until then the plan above is deliberately
              frozen — revising it now would defeat the purpose.
            </p>
          )}
        </Section>
      )}
    </>
  );
}
