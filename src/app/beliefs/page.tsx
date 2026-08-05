import Link from "next/link";
import { eventReach, getBeliefExposure, listEvents, listPositions } from "@/lib/queries";
import { money, pct, relativeDays } from "@/lib/format";
import { Badge, Bar, ConfidenceMeter, PageHeader, Section } from "@/components/ui";
import { CorrelationCheck } from "@/components/correlation";
import { getCorrelationCheck } from "@/lib/correlation-report";

const FILL: Record<string, string> = { high: "#0f0f0e", medium: "#8a8a85", low: "#cfcfcb" };

export default function BeliefsPage() {
  const exposure = getBeliefExposure();
  const held = listPositions().filter((p) => p.shares > 0.0001);
  const cell = new Map<string, string>();
  for (const e of exposure) {
    for (const l of e.links) cell.set(`${e.belief.id}|${l.positionId}`, l.sensitivity);
  }

  const top = exposure[0];
  const crowded = listEvents({ status: "upcoming" })
    .map((ev) => ({ ev, reach: eventReach(ev.id) }))
    .filter((x) => x.reach.length >= 2)
    .sort((a, b) => b.reach.length - a.reach.length);

  return (
    <>
      <PageHeader
        eyebrow="Beliefs"
        title="What the book is actually betting on"
        lede="A sector chart would show a chip designer, a utility, a miner and a REIT as four unrelated exposures. Read through to the beliefs underneath and they are largely one position expressed four ways."
      />

      {top && top.heldCount > 1 && (
        <section className="mb-12 border border-ink">
          <div className="sealed px-5 py-3">
            <span className="label label-ink text-paper!">Largest concentration</span>
          </div>
          <div className="px-5 py-6">
            <h2 className="display text-[22px] leading-snug">
              {pct(top.weightPct, 0)} of the book depends on{" "}
              <span className="italic">{top.belief.name.toLowerCase()}</span>
            </h2>
            <p className="writing mt-4">{top.belief.stance}</p>
            <div className="mt-6 grid gap-x-8 gap-y-5 sm:grid-cols-[1fr_auto]">
              <ul className="space-y-3">
                {top.links
                  .filter((l) => l.position.shares > 0.0001)
                  .sort((a, b) => b.position.weightPct - a.position.weightPct)
                  .map((l) => (
                    <li key={l.id} className="grid grid-cols-[54px_1fr_52px] items-center gap-4">
                      <Link href={`/positions/${l.positionId}`} className="num link text-[13px] font-medium">
                        {l.position.ticker}
                      </Link>
                      <Bar pct={l.position.weightPct} tone={l.sensitivity === "high" ? "ink" : "mid"} />
                      <span className="num text-right text-[11.5px] text-ink-2">
                        {pct(l.position.weightPct)}
                      </span>
                    </li>
                  ))}
              </ul>
              <div className="sm:w-[190px]">
                <div className="label mb-1.5">Your conviction in it</div>
                <ConfidenceMeter value={top.belief.confidence} />
                <p className="mt-3 text-[12px] leading-relaxed text-ink-3">
                  {top.belief.confidence !== null && top.weightPct > 50 && top.belief.confidence < 5
                    ? "Sizing and conviction do not agree. The book is more committed to this belief than you say you are."
                    : "Sizing and stated conviction are broadly aligned."}
                </p>
              </div>
            </div>
          </div>
        </section>
      )}

      <Section
        label="Belief × position"
        title="Filled square = high sensitivity, grey = medium, pale = low"
      >
        <div className="-mx-6 overflow-x-auto px-6 sm:mx-0 sm:px-0">
          <table className="w-full min-w-[680px] border-collapse">
            <thead>
              <tr>
                <th className="label w-[34%] border-b border-rule-2 pb-2 text-left font-medium">
                  Belief
                </th>
                {held.map((p) => (
                  <th key={p.id} className="border-b border-rule-2 pb-2 px-1 text-center align-bottom">
                    <Link href={`/positions/${p.id}`} className="num link text-[11.5px] font-medium">
                      {p.ticker}
                    </Link>
                    <div className="num mt-1 text-[10px] font-normal text-ink-4">
                      {pct(p.weightPct, 0)}
                    </div>
                  </th>
                ))}
                <th className="label w-[168px] border-b border-rule-2 pb-2 pl-3 text-right font-medium">
                  Book at risk
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-rule">
              {exposure.map((e) => (
                <tr key={e.belief.id} className="hover:bg-wash/60">
                  <td className="py-3 pr-4">
                    <Link href={`/beliefs/${e.belief.id}`} className="group block max-w-[280px]">
                      <span className="text-[13px] font-medium group-hover:underline group-hover:underline-offset-4">
                        {e.belief.name}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-ink-4">
                        {e.heldCount === 0
                          ? "No held position expresses this"
                          : `${e.heldCount} position${e.heldCount === 1 ? "" : "s"}`}
                      </span>
                    </Link>
                  </td>
                  {held.map((p) => {
                    const s = cell.get(`${e.belief.id}|${p.id}`);
                    return (
                      <td key={p.id} className="px-1 py-3 text-center">
                        {s ? (
                          <span
                            title={`${p.ticker} — ${s} sensitivity to ${e.belief.name}`}
                            className="inline-block h-[15px] w-[15px] border border-rule-2"
                            style={{ background: FILL[s] }}
                          />
                        ) : (
                          <span className="inline-block h-[15px] w-[15px]" />
                        )}
                      </td>
                    );
                  })}
                  <td className="py-3 pl-3">
                    <div className="flex items-center justify-end gap-3">
                      <span className="w-[70px]">
                        <Bar pct={e.weightPct} height={5} />
                      </span>
                      <span className="num w-[42px] text-right text-[11.5px] text-ink-2">
                        {pct(e.weightPct, 0)}
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-4 max-w-[74ch] text-[12px] leading-relaxed text-ink-3">
          Percentages do not sum to 100 — a single position can express several beliefs, and that
          overlap is the thing worth seeing. Reading down a column tells you what a position depends
          on; reading across a row tells you how much of the book one belief being wrong would touch.
        </p>
      </Section>

      <Section
        label="What the tape says"
        title="The same book, measured instead of declared"
      >
        <p className="writing mb-6 text-[14px]">
          The matrix above is your model of what connects these positions. This one is what actually
          happened to the prices. Where they agree, the belief is doing real work; where they
          disagree, either the exposure has not shown up yet or the connection was a story.
        </p>
        <CorrelationCheck check={getCorrelationCheck()} />
      </Section>

      {crowded.length > 0 && (
        <Section label="One event, several positions" title="Where the overlap becomes a dated risk">
          <ul className="space-y-4">
            {crowded.map(({ ev, reach }) => (
              <li key={ev.id} className="border border-rule px-5 py-4">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <Link href={`/events/${ev.id}`} className="link text-[14px] font-medium">
                    {ev.title}
                  </Link>
                  <span className="num text-[11.5px] text-ink-3">{relativeDays(ev.occurredAt)}</span>
                </div>
                <p className="mt-2.5 text-[12.5px] text-ink-2">
                  Reaches{" "}
                  <span className="num font-medium">{reach.map((r) => r.position.ticker).join(", ")}</span>{" "}
                  —{" "}
                  {pct(
                    reach.reduce((s, r) => s + r.position.weightPct, 0),
                    0
                  )}{" "}
                  of the book, {money(reach.reduce((s, r) => s + r.position.value, 0))}.
                </p>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </>
  );
}
