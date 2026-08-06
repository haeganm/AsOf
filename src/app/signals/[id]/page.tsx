import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { getSignal, outcomesFor, kindLabel, sourceLabel } from "@/lib/signals";
import { lastPerDay, sessionEndUtc, tradingDate, type DailyBar } from "@/lib/grade";
import { symbolSeriesId } from "@/lib/correlation-report";
import { shortDate, signedPct } from "@/lib/format";
import { Badge, PageHeader, Section, Stat } from "@/components/ui";
import { Spark } from "@/components/timeline";

/**
 * One signal's sealed moment: what the price path looked like up to the instant
 * the fact became knowable — and, separately and clearly labelled, what
 * happened afterwards. Deliberately minimal; the full decision-Replay room
 * stays a decision feature.
 */
export default async function SignalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = getSignal(id);
  if (!s) notFound();

  const all = lastPerDay(
    getDb()
      .prepare("select occurredAt as at, price as close from marks where positionId=? order by occurredAt")
      .all(symbolSeriesId(s.symbol)) as DailyBar[]
  );
  const known = Date.parse(s.knownAt);
  // Sealed: only closes that had printed before the fact was knowable.
  const sealed = all.filter((b) => Date.parse(sessionEndUtc(tradingDate(b.at))) <= known).slice(-90);
  const outcomes = outcomesFor(s.id);

  return (
    <>
      <PageHeader
        eyebrow={
          <span>
            <Link href="/signals" className="underline">Signals</Link> · {sourceLabel(s.source)}
          </span>
        }
        title={s.title}
        lede={s.detail ?? undefined}
      />

      <div className="mb-8 flex flex-wrap items-center gap-2">
        <Badge variant="solid">{s.symbol}</Badge>
        <Badge variant="outline">{kindLabel(s.kind)}</Badge>
        {s.direction !== "info" && <Badge variant="outline">{s.direction}</Badge>}
        {s.backfilled === 1 && (
          <Badge variant="dashed" title="Imported after the fact — never enters the live scorecard">
            backfilled
          </Badge>
        )}
        <span className="text-[12px] text-ink-3">
          knowable {shortDate(s.knownAt)} · sealed {shortDate(s.sealedAt)}
        </span>
      </div>

      <Section label="The sealed moment" title="What the chart showed, up to the instant this was knowable">
        {sealed.length >= 2 ? (
          <>
            <Spark points={sealed.map((b) => b.close)} at={sealed.map((b) => b.at)} width={560} height={80} />
            <p className="mt-2 text-[11.5px] text-ink-4">
              {sealed.length} daily closes to {shortDate(sealed[sealed.length - 1].at)}. Nothing after{" "}
              {shortDate(s.knownAt)} appears above this line.
            </p>
          </>
        ) : (
          <p className="writing text-[13.5px] text-ink-3">
            No cached price history for {s.symbol} before this moment.
          </p>
        )}
      </Section>

      <Section label="After the seal" title="What happened next">
        {outcomes.length === 0 ? (
          <p className="writing text-[13.5px] text-ink-3">
            Not graded yet — grades are written only once each horizon has fully elapsed, and never
            revised.
          </p>
        ) : (
          <div className="flex flex-wrap gap-8">
            {outcomes.map((o) => (
              <Stat
                key={o.horizonDays}
                label={`${o.horizonDays} trading days`}
                value={`${signedPct(o.excessReturn * 100)} vs SPY`}
                sub={`${s.symbol} ${signedPct(o.signalReturn * 100)} · SPY ${signedPct(o.benchmarkReturn * 100)}`}
              />
            ))}
          </div>
        )}
      </Section>
    </>
  );
}
