import Link from "next/link";
import { eventReach, listEvents } from "@/lib/queries";
import { pct, relativeDays, shortDate } from "@/lib/format";
import { Badge, ButtonLink, Empty, PageHeader, Section, VerdictMark } from "@/components/ui";

export default function EventsPage() {
  const all = listEvents();
  const now = new Date().toISOString();
  const upcoming = all.filter((e) => e.status === "upcoming" && e.occurredAt > now);
  const overdue = all.filter((e) => e.status === "upcoming" && e.occurredAt <= now);
  const resolved = all.filter((e) => e.status === "resolved").reverse();

  return (
    <>
      <PageHeader
        eyebrow="Events"
        title="Write the plan before the headline"
        lede="A catalyst is only useful if you decided what you would do under each outcome while you still had no idea which one was coming. Afterwards, AsOf compares what you expected with what happened — and asks whether you followed your own plan."
        actions={<ButtonLink href="/events/new" variant="solid">Prepare for an event</ButtonLink>}
      />

      {overdue.length > 0 && (
        <Section label="Passed without an outcome" title="These decay fast — write them up while you remember">
          <ul className="divide-y divide-rule border-y border-rule">
            {overdue.map((e) => (
              <li key={e.id}>
                <Link href={`/events/${e.id}`} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-4 hover:bg-wash/70">
                  <span className="num w-[86px] shrink-0 text-[11.5px] text-ink-2">
                    {shortDate(e.occurredAt)}
                  </span>
                  <span className="min-w-0 flex-1 text-[14px] font-medium">{e.title}</span>
                  <Badge variant="solid">Happened {relativeDays(e.occurredAt)}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section label="Ahead" title={`${upcoming.length} prepared`}>
        {upcoming.length === 0 ? (
          <Empty
            title="No catalysts on the calendar"
            body="Earnings, a ruling, a data release, a product launch — anything where you can write down what you expect before you find out."
            action={<ButtonLink href="/events/new">Prepare for an event</ButtonLink>}
          />
        ) : (
          <ul className="space-y-5">
            {upcoming.map((e) => {
              const reach = eventReach(e.id);
              const exposure = reach.reduce((s, r) => s + r.position.weightPct, 0);
              return (
                <li key={e.id} className="border border-rule">
                  <Link href={`/events/${e.id}`} className="block px-5 py-5 hover:bg-wash/60">
                    <div className="flex flex-wrap items-baseline justify-between gap-3">
                      <div className="flex flex-wrap items-baseline gap-3">
                        <span className="label">{e.kind}</span>
                        <span className="num text-[11.5px] text-ink-2">
                          {shortDate(e.occurredAt)} · {relativeDays(e.occurredAt)}
                        </span>
                      </div>
                      {reach.length > 2 && (
                        <Badge variant="outline">
                          Touches {reach.length} positions · {pct(exposure, 0)} of book
                        </Badge>
                      )}
                    </div>
                    <p className="mt-2.5 text-[16px] font-medium leading-snug">{e.title}</p>
                    {e.iExpect && <p className="writing mt-3 line-clamp-2 text-[13.5px]">{e.iExpect}</p>}
                    {e.scenarios.length > 0 && (
                      <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 border-t border-rule pt-3">
                        {e.scenarios.map((s) => (
                          <span key={s.name} className="num text-[12px] text-ink-2">
                            {s.name} <span className="text-ink-4">{s.probability}%</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      {resolved.length > 0 && (
        <Section label="Resolved" title="Expectation against reality">
          <ul className="divide-y divide-rule border-y border-rule">
            {resolved.map((e) => (
              <li key={e.id}>
                <Link href={`/events/${e.id}`} className="block py-4 hover:bg-wash/70">
                  <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
                    <span className="num w-[86px] shrink-0 text-[11.5px] text-ink-3">
                      {shortDate(e.occurredAt)}
                    </span>
                    <span className="min-w-0 flex-1 text-[14px] font-medium">{e.title}</span>
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="label mr-1">Forecast</span>
                      <VerdictMark value={e.outcome!.forecastAccurate} />
                      <span className="label mr-1 ml-2">Right variables</span>
                      <VerdictMark value={e.outcome!.rightVariables} />
                      <span className="label mr-1 ml-2">Followed plan</span>
                      <VerdictMark value={e.outcome!.followedPlan} />
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </>
  );
}
