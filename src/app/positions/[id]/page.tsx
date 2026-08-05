import Link from "next/link";
import { notFound } from "next/navigation";
import {
  beliefsForPosition,
  getAttentionItems,
  getPositionSnapshot,
  getPostmortemForPosition,
  getTimeline,
  listDecisions,
  listEvents,
  listEvidence,
  listThesisVersions,
  marksFor,
} from "@/lib/queries";
import { money, pct, relativeDays, shortDate, signedPct } from "@/lib/format";
import { AttentionQueue } from "@/components/attention";
import { Spark, TimelineFeed } from "@/components/timeline";
import {
  AssumptionList,
  Badge,
  BulletList,
  ButtonLink,
  ConfidenceMeter,
  Field,
  PageHeader,
  Section,
  Stat,
} from "@/components/ui";

export default async function PositionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = getPositionSnapshot(id);
  if (!p) notFound();

  const thesis = p.thesis;
  const versions = listThesisVersions(id);
  const timeline = getTimeline(id);
  const beliefs = beliefsForPosition(id);
  const evidence = listEvidence(id);
  const decisions = listDecisions({ positionId: id });
  const events = listEvents({ positionId: id });
  const upcoming = events.filter((e) => e.status === "upcoming");
  const postmortem = getPostmortemForPosition(id);
  const marks = marksFor(id);
  const attention = getAttentionItems().filter((a) => a.positionId === id);
  const isHeld = p.shares > 0.0001;

  // Assumption ids appear on evidence; resolve them to text across every version
  // so a contradiction reads in English even if the assumption was later reworded.
  const assumptionText = (aid: string) => {
    for (const v of versions) {
      const hit = v.assumptions.find((a) => a.id === aid);
      if (hit) return hit.text;
    }
    return null;
  };
  const contradictedIds = thesis
    ? evidence
        .filter((e) => e.contradictsAssumptionId && e.occurredAt > thesis.occurredAt)
        .map((e) => e.contradictsAssumptionId!)
    : [];

  return (
    <>
      <PageHeader
        eyebrow={
          <span className="flex flex-wrap items-center gap-2">
            <span>{p.assetClass ?? "Position"}</span>
            <span className="text-ink-4">·</span>
            <span>
              {isHeld ? "Held" : p.status === "passed" ? "Passed — never owned" : "Closed"}
              {p.closedAt && ` ${shortDate(p.closedAt)}`}
            </span>
          </span>
        }
        title={
          <span className="flex flex-wrap items-baseline gap-3">
            <span className="num">{p.ticker}</span>
            <span className="text-[18px] font-normal text-ink-3">{p.name}</span>
          </span>
        }
        actions={
          <>
            <ButtonLink href={`/positions/${id}/evidence`}>Add evidence</ButtonLink>
            <ButtonLink href={`/decisions/new?position=${id}`} variant="solid">
              Record a decision
            </ButtonLink>
          </>
        }
      />

      <div className="mb-10 grid grid-cols-2 items-start gap-x-8 gap-y-7 border-b border-rule pb-8 sm:grid-cols-4 lg:grid-cols-5">
        <Stat
          label="Position"
          value={isHeld ? money(p.value) : "—"}
          sub={
            isHeld
              ? `${p.shares.toLocaleString()} sh · ${pct(p.weightPct)} of book`
              : p.status === "passed"
                ? "No shares ever held"
                : `Fully sold ${p.closedAt ? shortDate(p.closedAt) : ""}`
          }
        />
        <Stat
          label="Mark"
          value={p.price !== null ? money(p.price, { cents: true }) : "—"}
          sub={p.costBasis > 0 ? `Avg cost ${money(p.costBasis, { cents: true })}` : "No cost basis"}
        />
        <Stat
          label={p.status === "passed" ? "Since you passed" : "Return"}
          value={signedPct(p.returnPct)}
          sub={p.status === "passed" ? "Price move since the pass" : "On average cost"}
        />
        <Stat
          label="Conviction"
          value={thesis ? `${thesis.confidence}/5` : "—"}
          sub={thesis ? `Thesis v${thesis.versionNo}, ${relativeDays(thesis.occurredAt)}` : "No thesis"}
        />
        {marks.length > 1 && (
          <div className="col-span-2 sm:col-span-4 lg:col-span-1">
            <div className="label mb-2">Price path</div>
            <Spark points={marks.map((m) => m.price)} width={200} height={40} />
            <div className="num mt-1 flex justify-between text-[10px] text-ink-4">
              <span>{shortDate(marks[0].occurredAt)}</span>
              <span>now</span>
            </div>
          </div>
        )}
      </div>

      {attention.length > 0 && (
        <Section label="Needs your judgment" title="On this position">
          <AttentionQueue items={attention} />
        </Section>
      )}

      <div className="grid gap-x-12 gap-y-10 lg:grid-cols-[minmax(0,1fr)_268px]">
        <div className="min-w-0">
          {thesis ? (
            <Section
              label={`Thesis v${thesis.versionNo}`}
              title={`Written ${shortDate(thesis.occurredAt)}`}
              aside={
                <Link href={`/positions/${id}/thesis`} className="link">
                  Update the thesis
                </Link>
              }
            >
              <p className="writing-lg mb-8">{thesis.summary}</p>

              <div className="mb-9 grid gap-6 sm:grid-cols-2">
                <div className="border-t-2 border-rule-2 pt-3">
                  <div className="label mb-2">The market appears to believe</div>
                  <p className="writing text-[14px]">{thesis.marketView ?? "Not recorded."}</p>
                </div>
                <div className="border-t-2 border-ink pt-3">
                  <div className="label label-ink mb-2">You believe differently</div>
                  <p className="writing text-[14px] text-ink!">{thesis.variantView ?? "Not recorded."}</p>
                </div>
              </div>

              <div className="mb-8">
                <div className="label label-ink mb-3">
                  What has to be true
                  {contradictedIds.length > 0 && (
                    <span className="ml-2 font-normal normal-case tracking-normal text-ink-3">
                      — evidence has arrived against{" "}
                      {new Set(contradictedIds).size} of these since v{thesis.versionNo}
                    </span>
                  )}
                </div>
                <AssumptionList
                  assumptions={thesis.assumptions}
                  contradictedIds={contradictedIds}
                />
              </div>

              <div className="mb-2">
                <Field label="Would prove it wrong">
                  <BulletList items={thesis.falsifiers} />
                </Field>
                <Field label="Expected catalysts">
                  <BulletList items={thesis.catalysts} />
                </Field>
                <Field label="Main risks">
                  <BulletList items={thesis.risks} />
                </Field>
                <Field label="Time horizon" serif={false}>
                  {thesis.horizon ?? "Not recorded."}
                </Field>
                <Field label="Would add if">{thesis.addCondition ?? "Not recorded."}</Field>
                <Field label="Would trim if">{thesis.trimCondition ?? "Not recorded."}</Field>
                <Field label="Would exit if">{thesis.exitCondition ?? "Not recorded."}</Field>
              </div>

              {versions.length > 1 && (
                <details className="mt-8 border border-rule">
                  <summary className="cursor-pointer bg-wash px-4 py-3 text-[13px] font-medium hover:bg-wash-2">
                    What this thesis used to say · {versions.length} versions
                    <span className="ml-2 font-normal text-ink-3">
                      Earlier versions cannot be edited
                    </span>
                  </summary>
                  <ol className="divide-y divide-rule">
                    {versions.map((v) => (
                      <li key={v.id} className="px-4 py-4">
                        <div className="flex flex-wrap items-center gap-3">
                          <span className="num flex h-[18px] min-w-[24px] items-center justify-center bg-ink px-1 text-[10px] text-paper">
                            v{v.versionNo}
                          </span>
                          <span className="num text-[11.5px] text-ink-3">
                            {shortDate(v.occurredAt)}
                          </span>
                          <ConfidenceMeter value={v.confidence} showValue={false} />
                          {v.versionNo === thesis.versionNo && <Badge variant="outline">Current</Badge>}
                        </div>
                        <p className="writing mt-2.5 text-[14px]">{v.summary}</p>
                        {v.changeNote && (
                          <p className="mt-2.5 border-l-2 border-ink pl-3 text-[13px] leading-relaxed text-ink-2">
                            <span className="label mr-2">Why it changed</span>
                            {v.changeNote}
                          </p>
                        )}
                        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[11.5px] text-ink-3">
                          <span>Horizon: {v.horizon ?? "—"}</span>
                          <span>
                            Assumptions intact:{" "}
                            {v.assumptions.filter((a) => a.status === "intact").length}/
                            {v.assumptions.length}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ol>
                </details>
              )}
            </Section>
          ) : (
            <Section label="Thesis">
              <p className="text-[13px] text-ink-3">No thesis recorded for this position.</p>
            </Section>
          )}

          <Section
            label="Record"
            title={`${timeline.length} entries — facts, reads, decisions and events in one thread`}
          >
            <TimelineFeed entries={timeline} assumptionText={assumptionText} />
          </Section>
        </div>

        <aside className="min-w-0 space-y-9 lg:sticky lg:top-8 lg:self-start">
          <div>
            <div className="label label-ink mb-3 border-b border-rule pb-2">What this bets on</div>
            {beliefs.length === 0 ? (
              <p className="text-[12.5px] text-ink-4">No beliefs linked.</p>
            ) : (
              <ul className="space-y-4">
                {beliefs.map((b) => (
                  <li key={b.id}>
                    <Link href={`/beliefs/${b.beliefId}`} className="group block">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-[13px] font-medium group-hover:underline group-hover:underline-offset-4">
                          {b.belief.name}
                        </span>
                        <Badge variant={b.sensitivity === "high" ? "solid" : "quiet"}>
                          {b.sensitivity}
                        </Badge>
                      </div>
                      {b.relationship && (
                        <p className="mt-1.5 text-[12px] leading-relaxed text-ink-3">
                          {b.relationship}
                        </p>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {upcoming.length > 0 && (
            <div>
              <div className="label label-ink mb-3 border-b border-rule pb-2">Ahead</div>
              <ul className="space-y-3">
                {upcoming.map((ev) => (
                  <li key={ev.id}>
                    <Link href={`/events/${ev.id}`} className="link block text-[13px] leading-snug">
                      {ev.title}
                    </Link>
                    <span className="num text-[11px] text-ink-3">
                      {relativeDays(ev.occurredAt)} · {shortDate(ev.occurredAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {decisions.length > 0 && (
            <div>
              <div className="label label-ink mb-3 border-b border-rule pb-2">
                Replay a past decision
              </div>
              <ul className="space-y-2.5">
                {decisions.slice(0, 5).map((d) => (
                  <li key={d.id}>
                    <Link href={`/replay/${d.id}`} className="link block text-[12.5px] leading-snug">
                      {d.what}
                    </Link>
                    <span className="num text-[10.5px] text-ink-4">{shortDate(d.occurredAt)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <div className="label label-ink mb-3 border-b border-rule pb-2">Close the loop</div>
            {postmortem ? (
              <Link href={`/postmortems/${postmortem.id}`} className="btn btn-quiet w-full justify-center">
                Read the postmortem
              </Link>
            ) : (
              <>
                <Link
                  href={`/positions/${id}/postmortem`}
                  className="btn btn-quiet w-full justify-center"
                >
                  Write a postmortem
                </Link>
                <p className="mt-2 text-[11px] leading-snug text-ink-4">
                  {isHeld
                    ? "You do not have to close a position to review the decision behind it."
                    : "This position is closed and has no postmortem on record."}
                </p>
              </>
            )}
          </div>
        </aside>
      </div>
    </>
  );
}
