import Link from "next/link";
import { aggregateSignals, sourceLabel, MIN_FOR_CLAIM, type GroupSummary } from "@/lib/signals";
import { signedPct, shortDate } from "@/lib/format";
import { Empty, PageHeader, Section } from "@/components/ui";
import { GradingExplainer } from "@/components/grading-explainer";

/**
 * The Observatory. One question per row: of everything shouting at you, what
 * has actually worked, at what horizon, with what confidence? Live-collected
 * signals only — imported history cannot prove an edge.
 */
export default function ScorecardPage() {
  const groups = aggregateSignals("source", { includeBackfilled: false });

  return (
    <>
      <PageHeader
        eyebrow="Scorecard"
        title="What has actually worked"
        lede="Every signal source graded the same way: what the stock did after the signal, minus what the index did over the same days. Collected live, sealed at arrival, never revised."
      />

      <div className="mb-8">
        <GradingExplainer />
      </div>

      {groups.length === 0 ? (
        <Empty
          title="Nothing collected yet"
          body="Signals appear here as the daily refresh gathers them — monitor firings, insider buys, filings, your own decisions. The first grades arrive once a signal's 5-trading-day horizon has passed."
        />
      ) : (
        groups.map((g) => <SourceCard key={g.key} group={g} />)
      )}

      <p className="mt-10 border-t border-rule pt-4 text-[12px] leading-relaxed text-ink-4">
        With several sources and three horizons, some rows will look good by luck. An interval that
        excludes zero on a small sample is a suggestion, not a finding — the scorecard gets more
        honest the longer it runs. See also{" "}
        <Link href="/signals" className="underline">
          every signal it is built from
        </Link>
        .
      </p>
    </>
  );
}

function SourceCard({ group }: { group: GroupSummary }) {
  const collecting = group.rows.length === 0;
  return (
    <Section
      label={sourceLabel(group.key)}
      aside={
        <span className="text-[11.5px] text-ink-4">
          {group.total} signal{group.total === 1 ? "" : "s"} · collecting since{" "}
          {shortDate(group.firstKnownAt)}
        </span>
      }
    >
      {collecting ? (
        <p className="writing text-[13.5px] text-ink-3">
          Not enough history yet — signals are collected, but none has lived through its first
          5-trading-day horizon. This row fills in on its own.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-[13px]">
            <thead>
              <tr className="border-b border-rule text-left">
                <th className="label py-2 pr-4 font-normal">Horizon</th>
                <th className="label py-2 pr-4 font-normal">Graded</th>
                <th className="label py-2 pr-4 font-normal">Hit rate</th>
                <th className="label py-2 pr-4 font-normal">Median vs SPY</th>
                <th className="label py-2 font-normal">Middle half</th>
              </tr>
            </thead>
            <tbody>
              {group.rows.map((r) => {
                const thin = r.n < MIN_FOR_CLAIM;
                return (
                  <tr
                    key={r.horizonDays}
                    className={`border-b border-rule/60 ${thin ? "text-ink-4" : ""}`}
                  >
                    <td className="py-2.5 pr-4">{r.horizonDays} trading days</td>
                    <td className="py-2.5 pr-4 tabular-nums">{r.n}</td>
                    <td className="py-2.5 pr-4 tabular-nums">
                      {r.hits === null || r.hitInterval === null
                        ? "— (no direction)"
                        : thin
                          ? "withheld — sample too small"
                          : `${Math.round((r.hits / r.n) * 100)}% (${Math.round(r.hitInterval.low)}–${Math.round(r.hitInterval.high)}%)`}
                    </td>
                    <td className="py-2.5 pr-4 tabular-nums">
                      {thin ? "collecting" : signedPct(r.medianExcess * 100)}
                    </td>
                    <td className="py-2.5 tabular-nums">
                      {thin
                        ? `${r.n} of ${MIN_FOR_CLAIM} needed`
                        : `${signedPct(r.q1Excess * 100)} to ${signedPct(r.q3Excess * 100)}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {group.ungraded > 0 && (
            <p className="mt-2 text-[11.5px] text-ink-4">
              {group.ungraded} signal{group.ungraded === 1 ? "" : "s"} can never be graded — the
              symbol stopped trading before the horizon passed.
            </p>
          )}
        </div>
      )}
    </Section>
  );
}
