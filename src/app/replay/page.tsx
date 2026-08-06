import Link from "next/link";
import {
  getThesisAt,
  justBefore,
  listDecisions,
  listEvents,
  listEvidence,
  listPositions,
  listReplayAttempts,
  priceAt,
  sharesAt,
} from "@/lib/queries";
// `pct` is used for the as-of weight; `money` for the mark on that day.
import { money, pct, relativeDays, shortDate } from "@/lib/format";
import { Badge, ConfidenceMeter, PageHeader, Section } from "@/components/ui";

/**
 * Deliberately describes the *situation*, never the decision. What you chose is
 * part of the reveal, so the card cannot mention the action or the outcome.
 */
export default function ReplayIndex() {
  const positions = new Map(listPositions().map((p) => [p.id, p]));
  const now = new Date().toISOString();

  const setups = listDecisions()
    .filter((d) => d.occurredAt < now && d.positionId)
    // A position can be missing if a decision references an id that no longer
    // exists; dropping the row beats crashing the whole index.
    .filter((d) => positions.has(d.positionId!))
    .map((d) => {
      const asOf = justBefore(d.occurredAt);
      const p = positions.get(d.positionId!)!;
      const thesis = getThesisAt(d.positionId!, d.occurredAt);
      const shares = sharesAt(d.positionId!, asOf);
      const price = priceAt(d.positionId!, d.occurredAt);
      // Weight as it was on the day, not today's — the card is a description of
      // that moment and mixing the two produced "700 shares held, 0.0% of book".
      const bookThen = listPositions(asOf);
      const totalThen = bookThen.reduce((s, x) => s + x.value, 0);
      const weightThen =
        price !== null && totalThen > 0 ? ((shares * price) / totalThen) * 100 : 0;
      const evidenceCount = listEvidence(d.positionId!, { asOf: d.occurredAt }).length;
      const pending = listEvents({ asOf: d.occurredAt, positionId: d.positionId! }).filter(
        (e) => e.occurredAt > d.occurredAt
      );
      const attempts = listReplayAttempts(d.id);
      // Richer context makes for a better simulation, so rank on it.
      const score =
        (thesis ? 2 : 0) +
        Math.min(evidenceCount, 4) +
        (pending.length > 0 ? 3 : 0) +
        (d.outcomeVerdict ? 2 : 0) +
        (shares > 0 ? 1 : 0);
      return { d, p, thesis, shares, price, weightThen, evidenceCount, pending, attempts, score };
    })
    .sort((a, b) => b.score - a.score || b.d.occurredAt.localeCompare(a.d.occurredAt));

  const prime = setups.slice(0, 3);
  // The remainder is a browsable list, so date order beats context score.
  const rest = setups
    .slice(3)
    .sort((a, b) => b.d.occurredAt.localeCompare(a.d.occurredAt));

  return (
    <>
      <PageHeader
        eyebrow="Replay"
        title="Decide it again, without knowing how it ended"
        lede="Pick a moment. AsOf rebuilds the book as it stood, hides everything that came afterwards — including what you actually chose — and asks you to decide. Only then does it show you the two answers side by side."
      />

      <div className="mb-11 border border-ink">
        <div className="sealed px-5 py-3">
          <span className="label label-ink text-paper!">How this works</span>
        </div>
        <ol className="divide-y divide-rule">
          {[
            [
              "You enter the room",
              "The portfolio, the position size, the thesis in force, the evidence on hand, and the catalyst ahead — all exactly as they were on the day. Nothing later is loaded.",
            ],
            [
              "You decide",
              "Choose the action, write the reasoning, set your confidence. You are committing before you can see anything.",
            ],
            [
              "Both answers, then the outcome",
              "What you chose then, what you chose now, what actually happened — and a list of the things you could not have known, so you can check whether your new answer quietly used them.",
            ],
          ].map(([t, b], i) => (
            <li key={t} className="grid grid-cols-[28px_1fr] gap-4 px-5 py-4">
              <span className="num text-[12px] text-ink-4">{i + 1}</span>
              <div>
                <p className="text-[13.5px] font-medium">{t}</p>
                <p className="writing mt-1 text-[13px]">{b}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>

      <Section label="Best candidates" title="The moments with the most context to work with">
        <ul className="grid gap-5 lg:grid-cols-3">
          {prime.map((s) => (
            <li key={s.d.id} className="flex flex-col border border-rule">
              <div className="border-b border-rule px-5 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="num text-[15px] font-medium">{s.p.ticker}</span>
                  <span className="num text-[11px] text-ink-3">{shortDate(s.d.occurredAt)}</span>
                </div>
                <p className="mt-0.5 text-[11px] text-ink-4">{relativeDays(s.d.occurredAt)}</p>
              </div>
              <div className="flex-1 px-5 py-4">
                <dl className="space-y-3 text-[12.5px]">
                  <div className="flex justify-between gap-3">
                    <dt className="text-ink-3">You held</dt>
                    <dd className="num">
                      {s.shares > 0 ? `${s.shares.toLocaleString()} sh` : "Nothing yet"}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-ink-3">Mark</dt>
                    <dd className="num">{s.price !== null ? money(s.price, { cents: true }) : "—"}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-ink-3">Thesis</dt>
                    <dd className="num">{s.thesis ? `v${s.thesis.versionNo}` : "None"}</dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="text-ink-3">Conviction</dt>
                    <dd>
                      <ConfidenceMeter value={s.thesis?.confidence ?? null} showValue={false} />
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-ink-3">On file</dt>
                    <dd className="num">{s.evidenceCount} entries</dd>
                  </div>
                </dl>
                {s.pending.length > 0 && (
                  <p className="mt-4 border-t border-rule pt-3 text-[12px] leading-relaxed text-ink-2">
                    <span className="label mb-1 block">Ahead of you</span>
                    {s.pending[0].title} —{" "}
                    {relativeDays(s.pending[0].occurredAt, s.d.occurredAt).replace("in ", "in ")}
                  </p>
                )}
                {s.attempts.length > 0 && (
                  <p className="mt-3">
                    <Badge variant="quiet">
                      Replayed {s.attempts.length}×
                    </Badge>
                  </p>
                )}
              </div>
              <Link href={`/replay/${s.d.id}`} className="btn btn-solid m-5 mt-0 justify-center">
                Enter the room
              </Link>
            </li>
          ))}
        </ul>
      </Section>

      {rest.length > 0 && (
        <Section
          label="Every other moment on record"
          title={`${rest.length} decisions, most recent first`}
        >
          <ul className="divide-y divide-rule border-y border-rule">
            {rest.map((s) => (
              <li key={s.d.id}>
                <Link
                  href={`/replay/${s.d.id}`}
                  className="flex flex-wrap items-baseline gap-x-5 gap-y-1 py-3.5 hover:bg-wash/70"
                >
                  <span className="num w-[86px] shrink-0 text-[11.5px] text-ink-3">
                    {shortDate(s.d.occurredAt)}
                  </span>
                  <span className="num w-[52px] shrink-0 text-[13px] font-medium">{s.p.ticker}</span>
                  <span className="min-w-0 flex-1 text-[12.5px] text-ink-2">
                    {s.shares > 0
                      ? `${s.shares.toLocaleString()} shares held, ${pct(s.weightThen)} of the book`
                      : "No position held at the time"}
                    {s.thesis && ` · thesis v${s.thesis.versionNo}`}
                    {s.pending.length > 0 && ` · ${s.pending.length} catalyst ahead`}
                  </span>
                  <span className="text-[11.5px] text-ink-4">Replay</span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </>
  );
}
