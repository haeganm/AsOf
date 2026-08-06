import Link from "next/link";
import { describeMonitor, read, type Monitor } from "@/lib/monitors";
import { relativeDays } from "@/lib/format";
import { Badge, Empty } from "./ui";

/**
 * What the position is watching on its own.
 *
 * Each row says what is being watched, where the observable currently stands,
 * and what the investor wrote that crossing it would mean — so a firing arrives
 * with its own interpretation attached rather than as a bare alert.
 */
export function MonitorList({
  monitors,
  positionId,
  assumptionText,
}: {
  monitors: Monitor[];
  positionId: string;
  assumptionText?: (id: string) => string | null;
}) {
  if (monitors.length === 0) {
    return (
      <Empty
        title="Nothing is being watched automatically"
        body="A falsifier written as prose waits for you to notice it. Bound to a price, a macro series or a date, it can tell you itself."
        action={
          <Link href={`/positions/${positionId}/monitor`} className="btn btn-quiet">
            Bind a condition to something measurable
          </Link>
        }
      />
    );
  }

  const fired = monitors.filter((m) => m.state === "fired");

  return (
    <>
      {fired.length > 0 && (
        <p className="writing mb-5 text-[14px]">
          {fired.length === 1 ? "One condition has" : `${fired.length} conditions have`} been met. That
          is already on the timeline as evidence — this is the standing list.
        </p>
      )}
      <ul className="divide-y divide-rule border-y border-rule">
        {monitors.map((m) => {
          const reading = read(m);
          const claim = m.assumptionId ? assumptionText?.(m.assumptionId) : null;
          return (
            <li key={m.id} className="py-4">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
                <span className="text-[14px] font-medium leading-snug">{m.label}</span>
                <Badge variant={m.state === "fired" ? "solid" : "quiet"}>
                  {m.state === "fired" ? "Condition met" : "Watching"}
                </Badge>
              </div>

              <div className="num mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[11.5px] text-ink-3">
                <span>{describeMonitor(m)}</span>
                <span className="text-ink-2">
                  {reading.value === null ? "no reading" : reading.describe}
                </span>
                {m.lastCheckedAt && <span className="text-ink-4">checked {relativeDays(m.lastCheckedAt)}</span>}
              </div>

              {claim && (
                <p className="mt-2.5 text-[12.5px] leading-relaxed text-ink-3">
                  Speaks for: <span className="italic">{claim}</span>
                </p>
              )}
              {m.meaning && <p className="writing mt-2 text-[13.5px]">{m.meaning}</p>}
            </li>
          );
        })}
      </ul>
      <Link href={`/positions/${positionId}/monitor`} className="link mt-4 inline-block text-[12.5px]">
        Watch something else
      </Link>
    </>
  );
}
