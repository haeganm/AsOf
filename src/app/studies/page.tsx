import Link from "next/link";
import { aggregateSignals, kindLabel, MIN_FOR_CLAIM, type GroupSummary } from "@/lib/signals";
import { shortDate, signedPct } from "@/lib/format";
import { Empty, PageHeader, Section } from "@/components/ui";
import { GradingExplainer } from "@/components/grading-explainer";

/**
 * The Event Study Machine: for each kind of event, what usually happened next.
 * Backfilled history is included here — sample size is the whole point — which
 * is exactly why these numbers never reach the live scorecard.
 */
export default function StudiesPage() {
  const groups = aggregateSignals("kind", { includeBackfilled: true }).sort(
    (a, b) => b.total - a.total
  );

  return (
    <>
      <PageHeader
        eyebrow="Studies"
        title="What usually happens next"
        lede="Each card is one kind of event, with the market's track record after every instance on file: the stock's move minus the index's move over the same days."
      />

      <div className="mb-4">
        <GradingExplainer />
      </div>

      <p className="mb-8 border border-dashed border-rule-2 px-4 py-3 text-[12.5px] leading-relaxed text-ink-3">
        Historical base rates here carry a survivorship caveat: the tracked universe was chosen
        recently, so past events only cover companies that survived to be chosen. Treat a base rate
        as context for the next instance, not proof of an edge — that is the scorecard&apos;s job,
        and it only counts what was collected live.
      </p>

      {groups.length === 0 ? (
        <Empty
          title="No events on file yet"
          body="Studies build themselves from collected signals — 8-K filings, insider buys, monitor firings. Run the daily ingest and this page fills in."
        />
      ) : (
        groups.map((g) => <StudyCard key={g.key} group={g} />)
      )}
    </>
  );
}

function StudyCard({ group }: { group: GroupSummary }) {
  return (
    <Section
      label={kindLabel(group.key)}
      aside={
        <Link href={`/signals?kind=${encodeURIComponent(group.key)}`} className="text-[11.5px] text-ink-3 underline">
          {group.total} instance{group.total === 1 ? "" : "s"} since {shortDate(group.firstKnownAt)}
        </Link>
      }
    >
      {group.rows.length === 0 ? (
        <p className="writing text-[13.5px] text-ink-3">
          No instance has lived through its first horizon yet — collecting.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-[13px]">
            <thead>
              <tr className="border-b border-rule text-left">
                <th className="label py-2 pr-4 font-normal">Horizon</th>
                <th className="label py-2 pr-4 font-normal">Graded</th>
                <th className="label py-2 pr-4 font-normal">Median vs SPY</th>
                <th className="label py-2 font-normal">Middle half</th>
              </tr>
            </thead>
            <tbody>
              {group.rows.map((r) => {
                const thin = r.n < MIN_FOR_CLAIM;
                return (
                  <tr key={r.horizonDays} className={`border-b border-rule/60 ${thin ? "text-ink-4" : ""}`}>
                    <td className="py-2.5 pr-4">{r.horizonDays} trading days</td>
                    <td className="py-2.5 pr-4 tabular-nums">{r.n}</td>
                    <td className="py-2.5 pr-4 tabular-nums">
                      {thin ? `collecting (${r.n} of ${MIN_FOR_CLAIM})` : signedPct(r.medianExcess * 100)}
                    </td>
                    <td className="py-2.5 tabular-nums">
                      {thin ? "—" : `${signedPct(r.q1Excess * 100)} to ${signedPct(r.q3Excess * 100)}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {group.ungraded > 0 && (
            <p className="mt-2 text-[11.5px] text-ink-4">
              Ungraded: {group.ungraded} — the symbol stopped trading before the horizon passed.
              Counted, not hidden.
            </p>
          )}
        </div>
      )}
    </Section>
  );
}
