import Link from "next/link";
import { notFound } from "next/navigation";
import { getDecision, getPositionSnapshot, getPostmortem, listThesisVersions } from "@/lib/queries";
import { VERDICT_LABEL, money, relativeDays, shortDate, signedPct } from "@/lib/format";
import { DecisionBlock } from "@/components/timeline";
import { Badge, PageHeader, Section, VerdictMark } from "@/components/ui";

const ROWS = [
  {
    key: "thesisCorrect",
    note: "thesisNote",
    q: "Was the thesis correct?",
    hint: "About the business, independent of what the price did.",
  },
  {
    key: "valuationRight",
    note: "valuationNote",
    q: "Was the valuation judgment right?",
    hint: "Whether you paid a sensible price for the outcome you were underwriting.",
  },
  {
    key: "sizingRight",
    note: "sizingNote",
    q: "Was the position sized appropriately?",
    hint: "Given the conviction you actually had, not the one you wish you had.",
  },
  {
    key: "timingRight",
    note: "timingNote",
    q: "Was the timing good?",
    hint: "Entry, exit, and whether you acted when your own rule said to.",
  },
  {
    key: "followedProcess",
    note: "processNote",
    q: "Did you follow your process?",
    hint: "The one question here that is entirely within your control.",
  },
] as const;

export default async function PostmortemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pm = getPostmortem(id);
  if (!pm) notFound();

  const p = getPositionSnapshot(pm.positionId);
  const decision = pm.decisionId ? getDecision(pm.decisionId) : null;
  const versions = p ? listThesisVersions(pm.positionId) : [];
  const v = pm.verdicts;

  // The headline observation: a good process and a bad outcome is the case the
  // product exists to name properly.
  const processHeld = v.followedProcess === "yes";
  const thesisWrong = v.thesisCorrect === "no";

  return (
    <>
      <PageHeader
        eyebrow={
          <span className="flex flex-wrap items-center gap-2">
            <span>Postmortem</span>
            <span className="text-ink-4">·</span>
            {p && (
              <Link href={`/positions/${p.id}`} className="link num">
                {p.ticker}
              </Link>
            )}
            <span className="text-ink-4">·</span>
            <span>
              {shortDate(pm.occurredAt)} — {relativeDays(pm.occurredAt)}
            </span>
          </span>
        }
        title={
          processHeld && thesisWrong
            ? "Wrong about the business. Right about how to be wrong."
            : "What this position taught you"
        }
        lede={
          p
            ? `${p.name}. ${p.status === "closed" ? "Closed" : "Held"}${p.exitAt ? ` ${shortDate(p.exitAt)}` : ""}${
                p.realisedPct !== null
                  ? `, realising ${money(p.realisedPnl)} — ${signedPct(p.realisedPct)} on the cost of the shares sold`
                  : p.returnPct !== null
                    ? `, ${signedPct(p.returnPct)} on average cost`
                    : ""
              }. The verdict grid below is the point of this page — a single win-or-lose label would throw away everything useful.`
            : undefined
        }
      />

      <Section label="The verdict grid" title="Six questions that a profit-and-loss number cannot answer">
        <dl className="divide-y divide-rule border-y border-rule">
          {ROWS.map((r) => {
            const value = v[r.key] as string;
            const note = v[r.note as keyof typeof v] as string | undefined;
            return (
              <div key={r.key} className="py-5 sm:grid sm:grid-cols-[1fr_112px] sm:gap-8">
                <div className="min-w-0">
                  <dt className="text-[14.5px] font-medium">{r.q}</dt>
                  <p className="mt-1 text-[12px] text-ink-4">{r.hint}</p>
                  {note && <dd className="writing mt-3 text-[14px]">{note}</dd>}
                </div>
                <div className="mt-3 sm:mt-0 sm:text-right">
                  <VerdictMark value={value} />
                </div>
              </div>
            );
          })}
          <div className="py-5 sm:grid sm:grid-cols-[1fr_112px] sm:gap-8">
            <div className="min-w-0">
              <dt className="text-[14.5px] font-medium">What actually drove the result?</dt>
              <p className="mt-1 text-[12px] text-ink-4">
                Skill, luck, or something outside the thesis entirely. Answering “skill” on a loss is
                allowed and is often correct.
              </p>
              {v.drivenByNote && <dd className="writing mt-3 text-[14px]">{v.drivenByNote}</dd>}
            </div>
            <div className="mt-3 sm:mt-0 sm:text-right">
              <Badge variant="solid">{VERDICT_LABEL[v.drivenBy] ?? v.drivenBy}</Badge>
            </div>
          </div>
        </dl>
      </Section>

      <Section label="The lesson">
        <p className="writing-lg">{pm.lesson}</p>
      </Section>

      {pm.processChange && (
        <Section label="What changes from here" title="A lesson with no process change is a feeling">
          <div className="border-l-[3px] border-ink pl-5">
            <p className="writing-lg">{pm.processChange}</p>
          </div>
        </Section>
      )}

      {decision && (
        <Section label="The decision this reviews">
          <div className="max-w-[680px]">
            <DecisionBlock d={decision} href={`/decisions/${decision.id}`} />
          </div>
          <Link href={`/replay/${decision.id}`} className="btn btn-quiet mt-5">
            Replay this decision without the outcome
          </Link>
        </Section>
      )}

      {versions.length > 1 && (
        <Section label="How the thesis moved" title={`${versions.length} versions, oldest last`}>
          <ol className="divide-y divide-rule border-y border-rule">
            {versions.map((t) => (
              <li key={t.id} className="py-4">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="num flex h-[18px] min-w-[24px] items-center justify-center bg-ink px-1 text-[10px] text-paper">
                    v{t.versionNo}
                  </span>
                  <span className="num text-[11.5px] text-ink-3">{shortDate(t.occurredAt)}</span>
                  <span className="num text-[11px] text-ink-4">
                    conviction {t.confidence}/5 · {t.assumptions.filter((a) => a.status === "intact").length}
                    /{t.assumptions.length} assumptions intact
                  </span>
                </div>
                <p className="writing mt-2.5 text-[14px]">{t.summary}</p>
                {t.changeNote && (
                  <p className="mt-2 border-l-2 border-rule-2 pl-3 text-[13px] leading-relaxed text-ink-2">
                    {t.changeNote}
                  </p>
                )}
              </li>
            ))}
          </ol>
        </Section>
      )}
    </>
  );
}
