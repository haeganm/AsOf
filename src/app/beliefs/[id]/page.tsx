import Link from "next/link";
import { notFound } from "next/navigation";
import { getBeliefExposure } from "@/lib/queries";
import { money, pct, relativeDays, shortDate } from "@/lib/format";
import { Badge, Bar, ConfidenceMeter, Field, PageHeader, Section } from "@/components/ui";

export default async function BeliefPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const all = getBeliefExposure();
  const e = all.find((x) => x.belief.id === id);
  if (!e) notFound();

  const rank = all.findIndex((x) => x.belief.id === id) + 1;
  const held = e.links.filter((l) => l.position.shares > 0.0001);
  const notHeld = e.links.filter((l) => l.position.shares <= 0.0001);
  const upcoming = e.events.filter((ev) => ev.status === "upcoming");
  const resolved = e.events.filter((ev) => ev.status === "resolved");

  return (
    <>
      <PageHeader
        eyebrow={`Belief · ${rank} of ${all.length} by exposure`}
        title={e.belief.name}
        lede={e.belief.description ?? undefined}
      />

      <div className="mb-11 grid gap-x-10 gap-y-8 border-b border-rule pb-9 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div>
          <div className="label label-ink mb-2">What you believe</div>
          <p className="writing-lg">{e.belief.stance ?? "No stance recorded."}</p>
        </div>
        <dl className="space-y-5">
          <div>
            <dt className="label mb-1.5">Your conviction</dt>
            <dd>
              <ConfidenceMeter value={e.belief.confidence} />
            </dd>
          </div>
          <div>
            <dt className="label mb-1.5">Book exposed</dt>
            <dd className="num text-[19px]">{pct(e.weightPct)}</dd>
            <dd className="mt-1 text-[11.5px] text-ink-3">
              {money(e.value)} across {held.length} position{held.length === 1 ? "" : "s"}
            </dd>
          </div>
          {e.highSensitivityWeightPct > 0 && (
            <div>
              <dt className="label mb-1.5">At high sensitivity</dt>
              <dd className="num text-[15px]">{pct(e.highSensitivityWeightPct)}</dd>
            </div>
          )}
        </dl>
      </div>

      {e.belief.confidence !== null && e.weightPct > 40 && e.belief.confidence <= 4 && (
        <p className="writing mb-11 border-l-2 border-ink pl-5 text-[14.5px]">
          You have {pct(e.weightPct, 0)} of the book behind a belief you rate{" "}
          {e.belief.confidence} out of 5. That is not necessarily wrong — conviction and edge are
          different things — but it is worth knowing that the sizing is making a stronger claim than
          you are.
        </p>
      )}

      <Section label="Positions expressing this" title={`${held.length} held`}>
        <ul className="space-y-6">
          {held
            .sort((a, b) => b.position.weightPct - a.position.weightPct)
            .map((l) => (
              <li key={l.id} className="border border-rule px-5 py-4">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <Link href={`/positions/${l.positionId}`} className="flex items-baseline gap-2.5">
                    <span className="num link text-[15px] font-medium">{l.position.ticker}</span>
                    <span className="text-[11.5px] text-ink-3">{l.position.name}</span>
                  </Link>
                  <Badge variant={l.sensitivity === "high" ? "solid" : "quiet"}>
                    {l.sensitivity} sensitivity
                  </Badge>
                </div>
                {l.relationship && <p className="writing mt-3 text-[14px]">{l.relationship}</p>}
                <div className="mt-4 grid grid-cols-[1fr_auto] items-center gap-4 border-t border-rule pt-3">
                  <Bar pct={l.position.weightPct} tone={l.sensitivity === "high" ? "ink" : "mid"} />
                  <span className="num text-[11.5px] text-ink-2">
                    {pct(l.position.weightPct)} of book · {money(l.position.value)}
                  </span>
                </div>
              </li>
            ))}
        </ul>
        {notHeld.length > 0 && (
          <p className="mt-5 text-[12.5px] text-ink-3">
            Also linked, not currently held:{" "}
            {notHeld.map((l, i) => (
              <span key={l.id}>
                {i > 0 && ", "}
                <Link href={`/positions/${l.positionId}`} className="link num">
                  {l.position.ticker}
                </Link>
              </span>
            ))}
            .
          </p>
        )}
      </Section>

      {upcoming.length > 0 && (
        <Section label="What will test it next">
          <ul className="divide-y divide-rule border-y border-rule">
            {upcoming.map((ev) => (
              <li key={ev.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-3.5">
                <span className="num w-[86px] shrink-0 text-[11.5px] text-ink-3">
                  {shortDate(ev.occurredAt)}
                </span>
                <Link href={`/events/${ev.id}`} className="link min-w-0 flex-1 text-[13.5px]">
                  {ev.title}
                </Link>
                <span className="num text-[11px] text-ink-4">{relativeDays(ev.occurredAt)}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {resolved.length > 0 && (
        <Section label="What has already tested it">
          <ul className="space-y-4">
            {resolved.map((ev) => (
              <li key={ev.id} className="border-l-2 border-ink pl-5">
                <Link href={`/events/${ev.id}`} className="link text-[13.5px] font-medium">
                  {ev.title}
                </Link>
                <p className="num mt-0.5 text-[11px] text-ink-4">{shortDate(ev.occurredAt)}</p>
                {ev.outcome && (
                  <p className="writing mt-2 text-[13.5px]">{ev.outcome.whatHappened}</p>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section label="Every belief" title="By share of the book">
        <ul className="divide-y divide-rule border-y border-rule">
          {all.map((x) => (
            <li key={x.belief.id} className="grid grid-cols-[1fr_120px_52px] items-center gap-4 py-3">
              <Link
                href={`/beliefs/${x.belief.id}`}
                className={`text-[13px] ${x.belief.id === id ? "font-medium" : "text-ink-2 hover:underline hover:underline-offset-4"}`}
              >
                {x.belief.name}
              </Link>
              <Bar pct={x.weightPct} tone={x.belief.id === id ? "ink" : "light"} height={5} />
              <span className="num text-right text-[11.5px] text-ink-3">{pct(x.weightPct, 0)}</span>
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}
