import Link from "next/link";
import { beliefsForPosition, listPositions } from "@/lib/queries";
import { money, pct, relativeDays } from "@/lib/format";
import { Badge, ButtonLink, ConfidenceMeter, PageHeader, Section } from "@/components/ui";

export default function PositionsPage() {
  const positions = listPositions();
  const groups = [
    { key: "held", title: "Held", items: positions.filter((p) => p.shares > 0.0001) },
    {
      key: "closed",
      title: "Closed",
      items: positions.filter((p) => p.shares <= 0.0001 && p.status === "closed"),
    },
    {
      key: "passed",
      title: "Passed and watched",
      items: positions.filter((p) => p.shares <= 0.0001 && p.status !== "closed"),
    },
  ].filter((g) => g.items.length > 0);

  return (
    <>
      <PageHeader
        eyebrow="Positions"
        title="Why each of these exists"
        lede="Every position carries a living thesis and an untouchable record of what it used to say. Closed and passed ideas stay here — a decision you did not take is still a decision you made."
        actions={<ButtonLink href="/positions/new" variant="solid">Add a position</ButtonLink>}
      />

      {groups.map((g) => (
        <Section key={g.key} label={g.title} title={`${g.items.length}`}>
          <ul className="grid gap-5 lg:grid-cols-2">
            {g.items.map((p) => {
              const beliefs = beliefsForPosition(p.id);
              const weak = p.thesis?.assumptions.filter((a) => a.status !== "intact") ?? [];
              return (
                <li key={p.id} className="border border-rule">
                  <Link href={`/positions/${p.id}`} className="block px-5 py-5 hover:bg-wash/60">
                    <div className="flex items-baseline justify-between gap-4">
                      <div className="flex items-baseline gap-2.5">
                        <span className="num text-[16px] font-medium">{p.ticker}</span>
                        <span className="text-[11.5px] text-ink-3">{p.name}</span>
                      </div>
                      <ConfidenceMeter value={p.thesis?.confidence ?? null} showValue={false} />
                    </div>

                    {p.thesis && (
                      <p className="writing mt-3 text-[14px]">{p.thesis.summary}</p>
                    )}

                    <div className="mt-4 grid grid-cols-3 gap-4 border-t border-rule pt-3">
                      <div>
                        <div className="label mb-1">
                          {p.shares > 0.0001 ? "Weight" : "Status"}
                        </div>
                        <div className="num text-[13px]">
                          {p.shares > 0.0001
                            ? pct(p.weightPct)
                            : p.status === "passed"
                              ? "Passed"
                              : "Closed"}
                        </div>
                      </div>
                      <div>
                        <div className="label mb-1">
                          {p.shares > 0.0001 ? "Value" : "Result"}
                        </div>
                        <div className="num text-[13px]">
                          {p.shares > 0.0001
                            ? money(p.value)
                            : p.returnPct !== null
                              ? pct(p.returnPct)
                              : "—"}
                        </div>
                      </div>
                      <div>
                        <div className="label mb-1">Last entry</div>
                        <div className="text-[12px] text-ink-2">
                          {p.lastActivityAt ? relativeDays(p.lastActivityAt) : "—"}
                        </div>
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
                      {beliefs.slice(0, 3).map((b) => (
                        <Badge key={b.id} variant={b.sensitivity === "high" ? "outline" : "quiet"}>
                          {b.belief.name}
                        </Badge>
                      ))}
                      {weak.length > 0 && (
                        <Badge variant="dashed">
                          {weak.length} of {p.thesis!.assumptions.length} assumptions shaky
                        </Badge>
                      )}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Section>
      ))}
    </>
  );
}
