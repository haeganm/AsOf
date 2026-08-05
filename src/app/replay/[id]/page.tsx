import Link from "next/link";
import { notFound } from "next/navigation";
import { saveHindsightNote, saveReplayAttempt } from "@/lib/actions";
import { getReplayContext, listEvidence, marksFor } from "@/lib/queries";
import { DECISION_LABEL, DECISION_TYPES } from "@/lib/types";
import { money, pct, relativeDays, shortDate, signedPct } from "@/lib/format";
import { ChipRadio, ConfidencePicker, Prose } from "@/components/forms";
import { DecisionBlock, EvidenceBlock, Spark, TimelineFeed } from "@/components/timeline";
import {
  AssumptionList,
  Badge,
  BulletList,
  Bar,
  ConfidenceMeter,
  Field,
  Section,
  Stat,
  VerdictMark,
} from "@/components/ui";

export default async function ReplayRoom({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ reveal?: string }>;
}) {
  const { id } = await params;
  const { reveal } = await searchParams;
  const ctx = getReplayContext(id);
  if (!ctx || !ctx.position) notFound();

  const { decision, position, thesisThen, asOf } = ctx;
  // The reveal is only unlocked by an attempt that actually exists. A guessed
  // query string does not open the box.
  const attempt = reveal ? ctx.attempts.find((a) => a.id === reveal) : undefined;
  const sealedDate = shortDate(decision.occurredAt);

  if (!attempt) {
    const heldThen = ctx.positionsThen.filter((p) => p.shares > 0.0001);
    const totalThen = heldThen.reduce((s, p) => s + p.value, 0);

    return (
      <>
        <div className="sealed -mx-6 mb-10 px-6 py-7 sm:-mx-10 sm:px-10">
          <div className="flex flex-wrap items-baseline justify-between gap-4">
            <div>
              <div className="label mb-2">Sealed · as of</div>
              <h1 className="display text-[27px] leading-tight text-paper">
                <span className="num">{position.ticker}</span>, {sealedDate}
              </h1>
            </div>
            <div className="num text-right text-[11px] text-[#a8a8a2]">
              {relativeDays(decision.occurredAt)}
              <br />
              {ctx.attempts.length > 0 && `${ctx.attempts.length} previous attempt${ctx.attempts.length === 1 ? "" : "s"}`}
            </div>
          </div>
          <p className="mt-5 max-w-[70ch] font-serif text-[15px] leading-relaxed text-[#dedede]">
            Everything below existed on this date. Everything after it is hidden — including what
            you actually decided and how it turned out. Read the room, then make the call.
          </p>
        </div>

        <div className="mb-11 grid grid-cols-2 gap-x-8 gap-y-7 border-b border-rule pb-8 sm:grid-cols-4">
          <Stat
            label="You held"
            value={ctx.position.shares > 0.0001 ? `${ctx.position.shares.toLocaleString()} sh` : "None"}
            sub={
              ctx.position.shares > 0.0001
                ? `${money(ctx.position.value)} · ${pct((ctx.position.value / (totalThen || 1)) * 100)} of the book`
                : "No position yet"
            }
          />
          <Stat
            label="Mark that day"
            value={ctx.priceThen !== null ? money(ctx.priceThen, { cents: true }) : "—"}
            sub={
              ctx.position.costBasis > 0
                ? `Avg cost ${money(ctx.position.costBasis, { cents: true })}`
                : "No cost basis yet"
            }
          />
          <Stat
            label="Thesis in force"
            value={thesisThen ? `v${thesisThen.versionNo}` : "None"}
            sub={thesisThen ? `Written ${shortDate(thesisThen.occurredAt)}` : undefined}
          />
          <Stat
            label="Your conviction"
            value={thesisThen ? `${thesisThen.confidence}/5` : "—"}
            sub="As recorded at the time"
          />
        </div>

        <div className="grid gap-x-12 gap-y-10 lg:grid-cols-[minmax(0,1fr)_282px]">
          <div className="min-w-0">
            {thesisThen && (
              <Section label={`Thesis v${thesisThen.versionNo}`} title="Your reasoning as it stood">
                <p className="writing-lg mb-8">{thesisThen.summary}</p>
                <div className="mb-8 grid gap-6 sm:grid-cols-2">
                  <div className="border-t-2 border-rule-2 pt-3">
                    <div className="label mb-2">The market believes</div>
                    <p className="writing text-[14px]">{thesisThen.marketView ?? "Not recorded."}</p>
                  </div>
                  <div className="border-t-2 border-ink pt-3">
                    <div className="label label-ink mb-2">You believe</div>
                    <p className="writing text-[14px] text-ink!">
                      {thesisThen.variantView ?? "Not recorded."}
                    </p>
                  </div>
                </div>
                <div className="label label-ink mb-3">What has to be true</div>
                <AssumptionList assumptions={thesisThen.assumptions} />
                <div className="mt-6">
                  <Field label="Would prove it wrong">
                    <BulletList items={thesisThen.falsifiers} />
                  </Field>
                  <Field label="Would add if">{thesisThen.addCondition ?? "Not recorded."}</Field>
                  <Field label="Would trim if">{thesisThen.trimCondition ?? "Not recorded."}</Field>
                  <Field label="Would exit if">{thesisThen.exitCondition ?? "Not recorded."}</Field>
                  <Field label="Horizon" serif={false}>{thesisThen.horizon ?? "Not recorded."}</Field>
                </div>
              </Section>
            )}

            {ctx.upcomingThen.length > 0 && (
              <Section label="Straight ahead" title="What you were waiting for">
                <ul className="space-y-6">
                  {ctx.upcomingThen.map((ev) => (
                    <li key={ev.id} className="border border-ink">
                      <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-rule px-4 py-2.5">
                        <span className="label label-ink">{ev.kind}</span>
                        <span className="num text-[11.5px]">
                          {shortDate(ev.occurredAt)} ·{" "}
                          {relativeDays(ev.occurredAt, decision.occurredAt)}
                        </span>
                      </div>
                      <div className="px-4 py-4">
                        <p className="text-[15px] font-medium">{ev.title}</p>
                        <div className="mt-4 grid gap-5 sm:grid-cols-2">
                          <div>
                            <div className="label mb-1.5">Market expects</div>
                            <p className="writing text-[13px]">{ev.marketExpects ?? "—"}</p>
                          </div>
                          <div>
                            <div className="label mb-1.5">You expect</div>
                            <p className="writing text-[13px]">{ev.iExpect ?? "—"}</p>
                          </div>
                        </div>
                        {ev.keyVariables.length > 0 && (
                          <div className="mt-4 border-t border-rule pt-3">
                            <div className="label mb-2">Variables you named</div>
                            <BulletList items={ev.keyVariables} />
                          </div>
                        )}
                        {ev.scenarios.length > 0 && (
                          <ul className="mt-4 divide-y divide-rule border-t border-rule">
                            {ev.scenarios.map((s) => (
                              <li key={s.name} className="py-3">
                                <div className="grid grid-cols-[52px_1fr_40px] items-center gap-3">
                                  <span className="label label-ink">{s.name}</span>
                                  <Bar pct={s.probability} />
                                  <span className="num text-right text-[11.5px]">{s.probability}%</span>
                                </div>
                                {s.plannedAction && (
                                  <p className="writing mt-2 pl-0 text-[12.5px] sm:pl-[64px]">
                                    Plan: {s.plannedAction}
                                  </p>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            <Section
              label="On file that day"
              title={`${ctx.evidenceThen.length} entries — nothing dated after ${sealedDate}`}
            >
              {ctx.evidenceThen.length === 0 ? (
                <p className="text-[13px] text-ink-4">
                  Nothing on file. You were deciding on the thesis alone.
                </p>
              ) : (
                <ul className="space-y-7">
                  {ctx.evidenceThen.map((e) => (
                    <li key={e.id}>
                      <div className="num mb-2 text-[11px] text-ink-3">{shortDate(e.occurredAt)}</div>
                      <EvidenceBlock
                        e={e}
                        assumptionText={
                          e.contradictsAssumptionId
                            ? thesisThen?.assumptions.find((a) => a.id === e.contradictsAssumptionId)
                                ?.text ?? null
                            : null
                        }
                      />
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>

          <aside className="min-w-0 space-y-9">
            <div>
              <div className="label label-ink mb-3 border-b border-rule pb-2">
                The book that day
              </div>
              <ul className="space-y-3">
                {heldThen.map((p) => (
                  <li key={p.id} className="grid grid-cols-[46px_1fr_46px] items-center gap-3">
                    <span
                      className={`num text-[12px] ${p.id === position.id ? "font-medium" : "text-ink-2"}`}
                    >
                      {p.ticker}
                    </span>
                    <Bar
                      pct={(p.value / (totalThen || 1)) * 100}
                      tone={p.id === position.id ? "ink" : "light"}
                    />
                    <span className="num text-right text-[11px] text-ink-3">
                      {pct((p.value / (totalThen || 1)) * 100, 0)}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="num mt-4 border-t border-rule pt-2 text-[11.5px] text-ink-3">
                {money(totalThen)} invested · {heldThen.length} positions
              </p>
            </div>

            {ctx.beliefsThen.length > 0 && (
              <div>
                <div className="label label-ink mb-3 border-b border-rule pb-2">This bets on</div>
                <ul className="space-y-3">
                  {ctx.beliefsThen.map((b) => (
                    <li key={b.id}>
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-[12.5px] font-medium">{b.belief.name}</span>
                        <Badge variant={b.sensitivity === "high" ? "solid" : "quiet"}>
                          {b.sensitivity}
                        </Badge>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <p className="border border-dashed border-rule-2 px-4 py-4 font-serif text-[13px] leading-relaxed text-ink-2">
              You cannot see the price after this date, the evidence that arrived later, or what you
              chose. That is the entire point.
            </p>
          </aside>
        </div>

        <section className="mt-4 border-t-[3px] border-ink pt-9">
          <div className="label label-ink mb-2">Your call</div>
          <h2 className="display mb-2 text-[22px]">What do you do?</h2>
          <p className="writing mb-8 text-[14px]">
            Commit before you look. A weak answer here is more useful than a careful one written
            after the fact — the gap between them is the only thing this exercise can measure.
          </p>

          <form action={saveReplayAttempt} className="max-w-[760px] space-y-8">
            <input type="hidden" name="decisionId" value={id} />
            <ChipRadio
              label="Action"
              name="newChoice"
              defaultValue="hold"
              options={DECISION_TYPES.filter((t) => t !== "thesis_change").map((t) => ({
                value: t,
                label: DECISION_LABEL[t],
              }))}
            />
            <Prose
              label="Why"
              name="newReasoning"
              required
              big
              rows={6}
              placeholder="Reason from what is on this page. If something on it changes your mind that did not at the time, say so — that is a finding about your process, not a mistake."
            />
            <ConfidencePicker
              name="newConfidence"
              hint="Your conviction now, on this information only."
            />
            <div className="flex flex-wrap items-center gap-4 border-t border-rule pt-6">
              <button type="submit" className="btn btn-solid">
                Commit and reveal
              </button>
              <Link href="/replay" className="btn btn-quiet">
                Leave without deciding
              </Link>
            </div>
          </form>
        </section>
      </>
    );
  }

  // ── reveal ──────────────────────────────────────────────────────────────
  const sameCall = attempt.newChoice === decision.type;
  const confDelta = attempt.newConfidence - decision.confidence;
  const laterEvidence = position ? listEvidence(position.id, { after: decision.occurredAt }) : [];
  const pricePath = [
    ...(ctx.priceThen !== null ? [ctx.priceThen] : []),
    ...ctx.marksAfter.map((m) => m.price),
  ];
  const pricePathAt = [
    ...(ctx.priceThen !== null ? [decision.occurredAt] : []),
    ...ctx.marksAfter.map((m) => m.occurredAt),
  ];
  const peak = ctx.marksAfter.length ? Math.max(...ctx.marksAfter.map((m) => m.price)) : null;
  const trough = ctx.marksAfter.length ? Math.min(...ctx.marksAfter.map((m) => m.price)) : null;

  return (
    <>
      <header className="mb-10 border-b border-rule pb-7">
        <div className="label mb-3">
          Reveal · {position.ticker} · {sealedDate}
        </div>
        <h1 className="display text-[29px] leading-tight">
          {sameCall ? "You made the same call." : `Then you chose ${DECISION_LABEL[decision.type].toLowerCase()}. Now you chose ${DECISION_LABEL[attempt.newChoice].toLowerCase()}.`}
        </h1>
        <p className="writing mt-4">
          {sameCall
            ? "Consistency is worth something, but only if the reasoning matches too. Read the two side by side and check whether you arrived there the same way."
            : "A different answer is not automatically a better one. The question is whether the difference comes from judgment you have earned since, or from knowing how it turned out."}
        </p>
      </header>

      <Section label="Two answers to the same question">
        <div className="grid gap-6 lg:grid-cols-2">
          <div>
            <div className="label mb-3 border-b border-rule pb-2">What you decided then</div>
            <DecisionBlock d={{ ...decision, outcomeNote: null, outcomeVerdict: null, outcomeAt: null }} />
          </div>
          <div>
            <div className="label label-ink mb-3 border-b border-ink pb-2">What you decided now</div>
            <div className="border border-ink">
              <div className="flex items-center justify-between gap-4 border-b border-rule bg-wash px-3 py-[7px]">
                <span className="label label-ink">{DECISION_LABEL[attempt.newChoice]}</span>
                <span className="num text-[10.5px] tracking-wide text-ink-3">
                  {shortDate(attempt.createdAt)}
                </span>
              </div>
              <div className="px-4 py-4">
                <p className="writing text-[14px]">{attempt.newReasoning}</p>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-rule pt-3">
                  <ConfidenceMeter value={attempt.newConfidence} label="Confidence" />
                  {confDelta !== 0 && (
                    <Badge variant="dashed">
                      {confDelta > 0 ? "+" : "−"}
                      {Math.abs(confDelta)} vs then
                    </Badge>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 border border-rule bg-wash px-5 py-4">
          <div className="label mb-2">Read on the two</div>
          <p className="writing text-[13.5px]">
            {sameCall ? "Same action" : "Different action"}
            {confDelta === 0
              ? ", same confidence"
              : `, confidence ${confDelta > 0 ? "up" : "down"} by ${Math.abs(confDelta)}`}
            .{" "}
            {sameCall && confDelta > 0
              ? "You are more sure of the same call than you were at the time. Nothing on the sealed page justifies that extra certainty — it can only have come from knowing more than you did."
              : sameCall
                ? "You would do it again with no more conviction than you had. That is about as clean a signal as this exercise produces."
                : confDelta > 0
                  ? "You changed your mind and became more confident. Worth being suspicious of: a genuinely close call rarely resolves into certainty on the same information."
                  : "You changed your mind and are less sure. That combination is usually honest reconsideration rather than hindsight."}
          </p>
        </div>
      </Section>

      <Section label="What happened next" title={`After ${sealedDate}`}>
        <div className="mb-8 grid grid-cols-2 gap-x-8 gap-y-7 sm:grid-cols-4">
          <Stat
            label="Mark that day"
            value={ctx.priceThen !== null ? money(ctx.priceThen, { cents: true }) : "—"}
          />
          <Stat
            label="Mark now"
            value={ctx.priceNow !== null ? money(ctx.priceNow, { cents: true }) : "—"}
            sub={signedPct(ctx.priceChangePct)}
          />
          {/* Only shown once the price has actually moved on past the decision. */}
          {peak !== null && trough !== null && ctx.priceThen !== null && (
            <>
              <Stat
                label="High after"
                value={money(peak, { cents: true })}
                sub={`${signedPct((peak / ctx.priceThen - 1) * 100)} from here`}
              />
              <Stat
                label="Low after"
                value={money(trough, { cents: true })}
                sub={`${signedPct((trough / ctx.priceThen - 1) * 100)} from here`}
              />
            </>
          )}
        </div>

        {pricePath.length >= 2 && (
          <div className="mb-9">
            <Spark points={pricePath} at={pricePathAt} width={640} height={80} />
            <div className="num mt-1 flex justify-between text-[10.5px] text-ink-4">
              <span>{sealedDate}</span>
              <span>today</span>
            </div>
          </div>
        )}

        {decision.outcomeVerdict && (
          <div className="mb-9 border border-ink">
            <div className="sealed flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
              <span className="label label-ink text-paper!">
                What you wrote when you judged this decision
              </span>
              <VerdictMark value={decision.outcomeVerdict} />
            </div>
            <p className="writing px-5 py-4">{decision.outcomeNote}</p>
          </div>
        )}

        {laterEvidence.length > 0 && (
          <div className="mb-9">
            <div className="label label-ink mb-2">
              Things you could not have known — {laterEvidence.length}
            </div>
            <p className="writing mb-4 text-[13.5px]">
              Each of these arrived after the decision. If any of your new reasoning leans on one of
              them, the difference between your two answers is hindsight rather than judgment.
            </p>
            <ul className="divide-y divide-rule border-y border-rule">
              {laterEvidence.map((e) => (
                <li key={e.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-3">
                  <span className="num w-[86px] shrink-0 text-[11px] text-ink-3">
                    {shortDate(e.occurredAt)}
                  </span>
                  <span className="num w-[68px] shrink-0 text-[10.5px] text-ink-4">
                    +{Math.round(
                      (new Date(e.occurredAt).getTime() - new Date(decision.occurredAt).getTime()) /
                        86_400_000
                    )}
                    d
                  </span>
                  <span className="min-w-0 flex-1 text-[13px] text-ink-2">{e.title}</span>
                  <Badge variant="quiet">{e.kind === "fact" ? "Fact" : "Read"}</Badge>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div>
          <div className="label label-ink mb-4">Everything on the record since</div>
          <TimelineFeed
            entries={ctx.timelineAfter}
            emptyNote="Nothing was recorded on this position after that day."
          />
        </div>
      </Section>

      {ctx.postmortem && (
        <Section label="You already wrote a postmortem on this position">
          <p className="writing-lg">{ctx.postmortem.lesson}</p>
          <Link href={`/postmortems/${ctx.postmortem.id}`} className="link mt-4 inline-block text-[13px]">
            Read it in full
          </Link>
        </Section>
      )}

      <Section label="Last question" title="The one worth answering honestly">
        {attempt.hindsightNote ? (
          <p className="writing-lg">{attempt.hindsightNote}</p>
        ) : (
          <form action={saveHindsightNote} className="max-w-[720px]">
            <input type="hidden" name="attemptId" value={attempt.id} />
            <input type="hidden" name="decisionId" value={id} />
            <Prose
              label="How much of your new answer was hindsight?"
              name="hindsightNote"
              required
              rows={5}
              hint="The useful version of this answer names the specific thing you knew that you could not have known. “Hard to separate” is a legitimate answer if you say why."
            />
            <button type="submit" className="btn btn-solid mt-6">
              Save and close the replay
            </button>
          </form>
        )}
      </Section>

      <div className="flex flex-wrap gap-3 border-t border-rule pt-8">
        <Link href={`/replay/${id}`} className="btn btn-quiet">
          Replay this moment again
        </Link>
        <Link href="/replay" className="btn btn-quiet">
          Pick another moment
        </Link>
        <Link href={`/decisions/${id}`} className="btn btn-quiet">
          Open the original decision
        </Link>
      </div>
    </>
  );
}
