import Link from "next/link";
import { getDb } from "@/lib/db";
import {
  listSignals,
  outcomesFor,
  kindLabel,
  sourceLabel,
  type Signal,
} from "@/lib/signals";
import { relativeDays, shortDate, signedPct } from "@/lib/format";
import { Badge, Empty, PageHeader } from "@/components/ui";

/**
 * The raw feed: every sealed signal, newest first. This page is deliberately
 * unglamorous — it exists so any number on the scorecard can be traced back to
 * the individual rows it came from.
 */
export default async function SignalsPage({
  searchParams,
}: {
  searchParams: Promise<{ source?: string; kind?: string; symbol?: string }>;
}) {
  const params = await searchParams;
  const signals = listSignals({
    source: params.source,
    kind: params.kind,
    symbol: params.symbol,
    limit: 300,
  });

  const sources = (
    getDb().prepare("select distinct source from signals order by source").all() as Array<{
      source: string;
    }>
  ).map((r) => r.source);

  return (
    <>
      <PageHeader
        eyebrow="Signals"
        title="Everything collected"
        lede="Each row is one sealed claim: something notable happened for a symbol, recorded the moment it was knowable. Grades appear as horizons pass. Nothing here can be edited or deleted."
      />

      <form method="get" className="mb-6 flex flex-wrap items-end gap-3 text-[13px]">
        <label className="block">
          <span className="label mb-1 block">Source</span>
          <select name="source" defaultValue={params.source ?? ""} className="border border-rule-2 bg-paper px-2 py-1.5">
            <option value="">All</option>
            {sources.map((s) => (
              <option key={s} value={s}>
                {sourceLabel(s)}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="label mb-1 block">Symbol</span>
          <input
            name="symbol"
            defaultValue={params.symbol ?? ""}
            placeholder="e.g. NVDA"
            className="w-28 border border-rule-2 bg-paper px-2 py-1.5 uppercase"
          />
        </label>
        <button type="submit" className="border border-ink px-3 py-1.5">
          Filter
        </button>
        {(params.source || params.symbol || params.kind) && (
          <Link href="/signals" className="py-1.5 text-ink-3 underline">
            Clear
          </Link>
        )}
      </form>

      {signals.length === 0 ? (
        <Empty
          title="No signals yet"
          body="The daily refresh fills this feed on its own: monitor firings, insider buys, filings, your own recorded decisions. Run `npm run ingest` to collect now."
        />
      ) : (
        <ol className="divide-y divide-rule/60 border-t border-rule">
          {signals.map((s) => (
            <SignalRow key={s.id} signal={s} />
          ))}
        </ol>
      )}
    </>
  );
}

function SignalRow({ signal: s }: { signal: Signal }) {
  const outcomes = outcomesFor(s.id);
  return (
    <li className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-3">
      <span className="w-[92px] shrink-0 text-[11.5px] tabular-nums text-ink-4" title={s.knownAt}>
        {shortDate(s.knownAt)}
      </span>
      <span className="w-[64px] shrink-0 font-medium">{s.symbol}</span>
      <span className="min-w-0 flex-1">
        <Link href={`/signals/${s.id}`} className="text-[13.5px] hover:underline">
          {s.title}
        </Link>
        <span className="mt-0.5 block text-[11.5px] text-ink-4">
          {sourceLabel(s.source)} · {kindLabel(s.kind)} · knowable {relativeDays(s.knownAt)}
          {s.backfilled === 1 && " · imported history — off the live scorecard"}
        </span>
      </span>
      <span className="flex shrink-0 items-baseline gap-2">
        {s.direction !== "info" && <Badge variant="outline">{s.direction}</Badge>}
        {s.backfilled === 1 && <Badge variant="dashed">backfilled</Badge>}
        {outcomes.length > 0 ? (
          <span className="text-[11.5px] tabular-nums text-ink-2">
            {outcomes
              .map((o) => `${o.horizonDays}d ${signedPct(o.excessReturn * 100)}`)
              .join(" · ")}{" "}
            vs SPY
          </span>
        ) : (
          <span className="text-[11.5px] text-ink-4">ungraded so far</span>
        )}
      </span>
    </li>
  );
}
