import Link from "next/link";
import { listDecisions, listPositions } from "@/lib/queries";
import { DECISION_LABEL } from "@/lib/types";
import { relativeDays, shortDate } from "@/lib/format";
import { Badge, ButtonLink, ConfidenceMeter, PageHeader, Section, VerdictMark } from "@/components/ui";

export default function DecisionsPage() {
  const decisions = listDecisions();
  const positions = new Map(listPositions().map((p) => [p.id, p]));
  const open = decisions.filter((d) => !d.outcomeVerdict);

  return (
    <>
      <PageHeader
        eyebrow="Decisions"
        title="What you did, and what you thought at the time"
        lede="Each record holds the reasoning as it was, not as it reads now. The decisions without a recorded outcome are the ones costing you the most — every pattern AsOf can find is built from closed loops."
        actions={<ButtonLink href="/decisions/new" variant="solid">Record a decision</ButtonLink>}
      />

      {open.length > 0 && (
        <Section
          label="Open loops"
          title={`${open.length} decision${open.length === 1 ? "" : "s"} with no outcome written`}
        >
          <ul className="divide-y divide-rule border-y border-rule">
            {open.map((d) => (
              <li key={d.id}>
                <Link href={`/decisions/${d.id}`} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-3.5 hover:bg-wash/70">
                  <span className="num w-[86px] shrink-0 text-[11.5px] text-ink-3">
                    {shortDate(d.occurredAt)}
                  </span>
                  <Badge variant="outline">{DECISION_LABEL[d.type]}</Badge>
                  <span className="min-w-0 flex-1 text-[13.5px]">{d.what}</span>
                  <ConfidenceMeter value={d.confidence} showValue={false} />
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section label="All decisions" title={`${decisions.length} on record`}>
        <ol className="space-y-4">
          {decisions.map((d) => {
            const p = d.positionId ? positions.get(d.positionId) : null;
            return (
              <li key={d.id} className="border border-rule">
                <Link href={`/decisions/${d.id}`} className="block px-5 py-4 hover:bg-wash/60">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <Badge variant="solid">{DECISION_LABEL[d.type]}</Badge>
                    {p && <span className="num text-[13px] font-medium">{p.ticker}</span>}
                    <span className="num text-[11.5px] text-ink-3">
                      {shortDate(d.occurredAt)} · {relativeDays(d.occurredAt)}
                    </span>
                    <span className="ml-auto flex items-center gap-3">
                      <ConfidenceMeter value={d.confidence} showValue={false} />
                      {d.outcomeVerdict ? (
                        <VerdictMark value={d.outcomeVerdict} />
                      ) : (
                        <Badge variant="quiet">No outcome</Badge>
                      )}
                    </span>
                  </div>
                  <p className="mt-3 text-[14.5px] font-medium leading-snug">{d.what}</p>
                  <p className="writing mt-2 line-clamp-3 text-[13.5px]">{d.why}</p>
                </Link>
              </li>
            );
          })}
        </ol>
      </Section>
    </>
  );
}
