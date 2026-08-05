import Link from "next/link";
import {
  getAttentionItems,
  getBeliefExposure,
  getPortfolio,
  listDecisions,
  listEvents,
  listPositions,
  eventReach,
} from "@/lib/queries";
import { money, pct, relativeDays, shortDate } from "@/lib/format";
import { AttentionQueue } from "@/components/attention";
import { Bar, ButtonLink, ConfidenceMeter, PageHeader, Section, Stat } from "@/components/ui";

export default function Dashboard() {
  const portfolio = getPortfolio();
  const positions = listPositions();
  const held = positions.filter((p) => p.shares > 0.0001);
  const attention = getAttentionItems();
  const exposure = getBeliefExposure();
  const top = exposure[0];
  const decisions = listDecisions();
  const openLoops = decisions.filter((d) => !d.outcomeVerdict);
  const bookValue = held.reduce((s, p) => s + p.value, 0);

  const upcoming = listEvents({ status: "upcoming" })
    .filter((e) => e.occurredAt > new Date().toISOString())
    .slice(0, 4);

  const oldestReview = held
    .filter((p) => p.lastActivityAt)
    .sort((a, b) => a.lastActivityAt!.localeCompare(b.lastActivityAt!))[0];

  return (
    <>
      <PageHeader
        eyebrow={portfolio.name}
        title={
          top && top.heldCount > 1 ? (
            <>
              {held.length} positions. {pct(top.weightPct, 0)} of the book rests on{" "}
              <span className="italic">{top.belief.name.toLowerCase()}</span>.
            </>
          ) : (
            <>{held.length} positions on the book.</>
          )
        }
        lede="This page reads your own record rather than the tape. It shows where what you wrote down has drifted from what you now know — and leaves the judgment to you."
        actions={
          <>
            <ButtonLink href="/decisions/new">Record a decision</ButtonLink>
            <ButtonLink href="/replay" variant="solid">
              Replay a decision
            </ButtonLink>
          </>
        }
      />

      <div className="mb-12 grid grid-cols-2 gap-x-8 gap-y-7 border-b border-rule pb-8 sm:grid-cols-4">
        <Stat
          label="Book value"
          value={money(bookValue)}
          sub={`${held.length} held · ${positions.length - held.length} closed or passed`}
        />
        <Stat
          label="Decisions on record"
          value={decisions.length}
          sub={`${decisions.length - openLoops.length} with an outcome written`}
        />
        <Stat
          label="Open loops"
          value={openLoops.length}
          sub="Decisions whose result you have not yet judged"
        />
        <Stat
          label="Quietest position"
          value={oldestReview ? oldestReview.ticker : "—"}
          sub={
            oldestReview?.lastActivityAt
              ? `Last entry ${relativeDays(oldestReview.lastActivityAt)}`
              : "No activity recorded"
          }
        />
      </div>

      <Section
        label="Needs your judgment"
        title={`${attention.length} item${attention.length === 1 ? "" : "s"} in tension`}
      >
        <AttentionQueue items={attention} limit={5} />
      </Section>

      <Section label="The book" title="Sorted by size" aside={<Link href="/positions" className="link">All positions</Link>}>
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-rule-2">
              {["Position", "Weight", "Size", "Return", "Conviction", "Reviewed"].map((h, i) => (
                <th
                  key={h}
                  className={`label pb-2 font-medium ${i === 0 ? "" : "text-right"} ${
                    i === 1 ? "w-[130px]" : ""
                  }`}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-rule">
            {positions.map((p) => {
              const isHeld = p.shares > 0.0001;
              return (
                <tr key={p.id} className="align-top transition-colors hover:bg-wash/70">
                  <td className="py-4 pr-6">
                    <Link href={`/positions/${p.id}`} className="group block">
                      <div className="flex items-baseline gap-2.5">
                        <span className="num text-[14px] font-medium group-hover:underline group-hover:underline-offset-4">
                          {p.ticker}
                        </span>
                        <span className="text-[11.5px] text-ink-3">{p.name}</span>
                        {!isHeld && (
                          <span className="label border border-rule-2 px-1 py-[1px] text-[9px]">
                            {p.status === "passed" ? "Passed" : "Closed"}
                          </span>
                        )}
                      </div>
                      {p.thesis && (
                        <p className="mt-1.5 max-w-[62ch] font-serif text-[13px] leading-snug text-ink-2">
                          {p.thesis.summary}
                        </p>
                      )}
                    </Link>
                  </td>
                  <td className="py-4 pl-2 pr-6">
                    {isHeld ? (
                      <div className="pt-1">
                        <Bar pct={p.weightPct} />
                        <div className="num mt-1.5 text-right text-[11.5px] text-ink-2">
                          {pct(p.weightPct)}
                        </div>
                      </div>
                    ) : (
                      <div className="num pt-1 text-right text-[11.5px] text-ink-4">—</div>
                    )}
                  </td>
                  <td className="num py-4 pr-6 text-right text-[12.5px] text-ink-2">
                    {isHeld ? (
                      <>
                        {money(p.value)}
                        <div className="mt-1 text-[11px] text-ink-4">
                          {p.shares.toLocaleString()} sh
                        </div>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="num py-4 pr-6 text-right text-[12.5px]">
                    {p.returnPct === null ? (
                      <span className="text-ink-4">—</span>
                    ) : (
                      <span className={p.returnPct < 0 ? "text-ink-3" : "text-ink"}>
                        {p.returnPct >= 0 ? "+" : "−"}
                        {Math.abs(p.returnPct).toFixed(1)}%
                      </span>
                    )}
                  </td>
                  <td className="py-4 pr-6 text-right">
                    <div className="inline-flex justify-end">
                      <ConfidenceMeter value={p.thesis?.confidence ?? null} showValue={false} />
                    </div>
                    {p.thesis && (
                      <div className="num mt-1 text-[10.5px] text-ink-4">v{p.thesis.versionNo}</div>
                    )}
                  </td>
                  <td className="py-4 text-right text-[11.5px] text-ink-3">
                    {p.lastActivityAt ? relativeDays(p.lastActivityAt) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Section>

      <Section
        label="Coming up"
        title="Catalysts you have written a plan for"
        aside={<Link href="/events" className="link">All events</Link>}
      >
        <ul className="grid gap-4 sm:grid-cols-2">
          {upcoming.map((ev) => {
            const reach = eventReach(ev.id);
            return (
              <li key={ev.id} className="border border-rule">
                <Link href={`/events/${ev.id}`} className="block px-4 py-4 hover:bg-wash/70">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="label">{ev.kind}</span>
                    <span className="num text-[11px] text-ink-2">{relativeDays(ev.occurredAt)}</span>
                  </div>
                  <p className="mt-2 text-[14px] font-medium leading-snug">{ev.title}</p>
                  <p className="mt-1 text-[11px] text-ink-4">{shortDate(ev.occurredAt)}</p>
                  {reach.length > 1 && (
                    <p className="mt-3 border-t border-rule pt-2.5 text-[12px] text-ink-2">
                      Reaches{" "}
                      <span className="font-medium">
                        {reach.length} position{reach.length === 1 ? "" : "s"}
                      </span>{" "}
                      — {reach.map((r) => r.position.ticker).join(", ")}
                    </p>
                  )}
                  {ev.scenarios.length > 0 && (
                    <p className="mt-2 text-[12px] text-ink-3">
                      {ev.scenarios.length} scenarios written · plan ready
                    </p>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </Section>
    </>
  );
}
