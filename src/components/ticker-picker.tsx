import Link from "next/link";
import { searchSecurities, universeSize } from "@/lib/ingest/securities";

/**
 * Answers "why can't I just pick a ticker?".
 *
 * A plain GET form back to the same page, so it works with no client JavaScript.
 * Choosing a symbol re-renders the form with the fields prefilled and the CIK
 * carried along, which is what lets filings be read later. Free text still works
 * — an unlisted symbol, a private holding or an offline machine must not be a
 * dead end.
 */
export function TickerPicker({
  q,
  selected,
  basePath,
}: {
  q: string;
  selected: string | null;
  basePath: string;
}) {
  const size = universeSize();
  const matches = q ? searchSecurities(q) : [];

  return (
    <div className="border border-rule bg-wash px-5 py-5">
      <div className="label label-ink mb-1">Find the security</div>
      <p className="writing mb-4 text-[13px]">
        {size > 0 ? (
          <>
            Searching {size.toLocaleString()} symbols cached from SEC&rsquo;s published ticker file.
            Picking one fills in the name and carries its CIK, so filings can be read later.
          </>
        ) : (
          <>
            No symbol universe cached yet — run{" "}
            <span className="num text-[12px]">npx tsx scripts/ingest.ts --universe</span> once. You
            can type a ticker by hand in the meantime.
          </>
        )}
      </p>

      <form method="get" action={basePath} className="flex flex-wrap items-end gap-3">
        <label className="min-w-[220px] flex-1">
          <span className="label">Company or ticker</span>
          <input
            className="field mt-1 text-[14px]"
            name="q"
            defaultValue={q}
            placeholder="constellation, NVDA, copper…"
            autoComplete="off"
          />
        </label>
        <button type="submit" className="btn btn-quiet">
          Search
        </button>
      </form>

      {q && matches.length === 0 && (
        <p className="mt-4 text-[12.5px] text-ink-3">
          Nothing matched “{q}”. ETFs, indices and futures are not in SEC&rsquo;s file — type those
          in directly (for example <span className="num">SMH</span>,{" "}
          <span className="num">^TNX</span>, <span className="num">HG=F</span>).
        </p>
      )}

      {matches.length > 0 && (
        <ul className="mt-4 divide-y divide-rule border-y border-rule">
          {matches.map((s) => {
            const params = new URLSearchParams({ ticker: s.ticker, name: s.name });
            if (s.cik) params.set("cik", s.cik);
            if (q) params.set("q", q);
            const isSelected = selected?.toUpperCase() === s.ticker;
            return (
              <li key={s.ticker}>
                <Link
                  href={`${basePath}?${params.toString()}`}
                  className={`flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2.5 hover:bg-paper ${
                    isSelected ? "bg-paper" : ""
                  }`}
                >
                  <span className="num w-[64px] shrink-0 text-[13px] font-medium">{s.ticker}</span>
                  <span className="min-w-0 flex-1 text-[12.5px] text-ink-2">{s.name}</span>
                  <span className="text-[11px] text-ink-4">
                    {isSelected ? "selected" : s.cik ? `CIK ${s.cik}` : ""}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
