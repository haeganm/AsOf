"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Search-as-you-type over the cached symbol universe, owning the ticker, name
 * and CIK fields so a selection fills them without a page load.
 *
 * The previous version was a GET form that navigated back to the same route,
 * which wiped anything already written in the thesis above. This is one client
 * island; everything else on the page stays server-rendered.
 */

interface Security {
  ticker: string;
  cik: string | null;
  name: string;
  exchange: string | null;
}

export function InstrumentPicker({
  defaultTicker = "",
  defaultName = "",
  defaultAssetClass = "",
}: {
  defaultTicker?: string;
  defaultName?: string;
  defaultAssetClass?: string;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Security[]>([]);
  const [universe, setUniverse] = useState<number | null>(null);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<Security | null>(null);

  const [ticker, setTicker] = useState(defaultTicker);
  const [name, setName] = useState(defaultName);
  const [cik, setCik] = useState("");

  // Latest-wins: an earlier, slower response must not overwrite a later one.
  const seq = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const mine = ++seq.current;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/securities?q=${encodeURIComponent(q)}`);
        const data = (await res.json()) as { results: Security[]; universe: number };
        if (mine !== seq.current) return;
        setResults(data.results);
        setUniverse(data.universe);
      } catch {
        if (mine === seq.current) setResults([]);
      } finally {
        if (mine === seq.current) setSearching(false);
      }
    }, 180);
    return () => clearTimeout(timer);
  }, [query]);

  function choose(s: Security) {
    setPicked(s);
    setTicker(s.ticker);
    setName(s.name);
    setCik(s.cik ?? "");
    setQuery("");
    setResults([]);
  }

  return (
    <>
      <div className="border border-rule bg-wash px-5 py-5">
        <label className="block">
          <span className="label label-ink">Find the security</span>
          <input
            className="field mt-1.5 text-[14px]"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="constellation, NVDA, vertiv…"
            autoComplete="off"
            aria-describedby="picker-hint"
          />
        </label>

        <p id="picker-hint" className="mt-2 text-[12px] leading-snug text-ink-3">
          {universe !== null ? (
            <>
              {universe.toLocaleString()} symbols cached from SEC&rsquo;s ticker file. Choosing one
              fills the name and carries its CIK, so filings can be read later. Nothing you have
              written is lost — this does not reload the page.
            </>
          ) : (
            <>
              Type at least two characters. ETFs, indices and futures are not in SEC&rsquo;s file —
              enter those directly below (for example <span className="num">SMH</span>,{" "}
              <span className="num">^TNX</span>, <span className="num">HG=F</span>).
            </>
          )}
        </p>

        {searching && <p className="mt-3 text-[12px] text-ink-4">Searching…</p>}

        {!searching && query.trim().length >= 2 && results.length === 0 && (
          <p className="mt-3 text-[12.5px] text-ink-3">
            Nothing matched “{query.trim()}”. You can still type the symbol in by hand.
          </p>
        )}

        {results.length > 0 && (
          <ul className="mt-4 divide-y divide-rule border-y border-rule">
            {results.map((s) => (
              <li key={s.ticker}>
                <button
                  type="button"
                  onClick={() => choose(s)}
                  className="flex w-full flex-wrap items-baseline gap-x-3 gap-y-1 py-2.5 text-left hover:bg-paper"
                >
                  <span className="num w-[64px] shrink-0 text-[13px] font-medium">{s.ticker}</span>
                  <span className="min-w-0 flex-1 text-[12.5px] text-ink-2">{s.name}</span>
                  <span className="num text-[10.5px] text-ink-4">
                    {s.cik ? `CIK ${s.cik}` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {picked && (
          <p className="mt-4 border-t border-rule pt-3 text-[12.5px] text-ink-2">
            Selected <span className="num font-medium">{picked.ticker}</span> — {picked.name}.
            {picked.cik
              ? " Filings will be read from SEC for this company."
              : " No CIK, so filings are unavailable for this symbol."}
          </p>
        )}
      </div>

      <input type="hidden" name="cik" value={cik} />
      <div className="grid gap-6 sm:grid-cols-3">
        <label className="block">
          <span className="label">
            Ticker<span className="ml-1 text-ink-4">· required</span>
          </span>
          <input
            className="field mt-1 text-[14px]"
            name="ticker"
            value={ticker}
            onChange={(e) => setTicker(e.target.value.toUpperCase())}
            placeholder="NVDA"
            required
          />
        </label>
        <label className="block">
          <span className="label">
            Name<span className="ml-1 text-ink-4">· required</span>
          </span>
          <input
            className="field mt-1 text-[14px]"
            name="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="NVIDIA Corporation"
            required
          />
        </label>
        <label className="block">
          <span className="label">Asset class</span>
          <input
            className="field mt-1 text-[14px]"
            name="assetClass"
            defaultValue={defaultAssetClass}
            placeholder="Equity — Semiconductors"
          />
        </label>
      </div>
    </>
  );
}
