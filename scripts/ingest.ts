/**
 * Pulls outside data into the book. Everything here is free and keyless.
 *
 *   npx tsx scripts/ingest.ts                 # universe if stale, then prices
 *   npx tsx scripts/ingest.ts --universe      # just refresh the symbol universe
 *   npx tsx scripts/ingest.ts --prices        # just prices for held positions
 *   npx tsx scripts/ingest.ts --full          # 5y backfill rather than a top-up
 *
 * A failure on one symbol never stops the others, and never leaves the app in a
 * state that cannot render.
 */
import { getDb } from "../src/lib/db";
import { refreshUniverse, universeSize, needsRefresh } from "../src/lib/ingest/securities";
import { dedupeSymbolDays, syncPrices } from "../src/lib/ingest/prices";
import { syncFilings } from "../src/lib/ingest/filings";
import { ensureUniverse, resolveCiks, listUniverse } from "../src/lib/ingest/universe";
import { fetchFilings } from "../src/lib/ingest/filings";
import { syncInsiders } from "../src/lib/ingest/insiders";
import { emitEightK } from "../src/lib/ingest/eightk";
import { startRun, finishRun } from "../src/lib/ingest/runs";
import { symbolSeriesId, symbolsToTrack } from "../src/lib/correlation-report";
import { evaluateMonitors } from "../src/lib/monitors";
import { computeOutcomes, BENCHMARK } from "../src/lib/signals";

const argv = process.argv.slice(2);
const only = (flag: string) => argv.includes(flag);
const full = only("--full");
// With no flags, run everything. With any source flag, run only what was asked.
const picked = ["--universe", "--prices", "--filings", "--insiders"].filter(only);
const wants = (flag: string) => picked.length === 0 || only(flag);
const wantUniverse = wants("--universe");
const wantPrices = wants("--prices");
const wantFilings = wants("--filings");
const wantInsiders = wants("--insiders");

async function main() {
  const db = getDb();
  // A dated header, because this output is appended to data/ingest.log by the
  // scheduled task and an undated log is close to useless.
  console.log(`\n=== ${new Date().toISOString()} ${argv.length ? argv.join(" ") : "(all sources)"} ===`);

  if (wantUniverse) {
    if (needsRefresh() || picked.includes("--universe")) {
      process.stdout.write("universe: fetching SEC ticker file… ");
      try {
        const { count, skipped } = await refreshUniverse(picked.includes("--universe"));
        console.log(skipped ? `fresh, ${count} symbols` : `${count} symbols cached`);
      } catch (err) {
        console.log(`failed (${String(err).slice(0, 120)})`);
      }
    } else {
      console.log(`universe: ${universeSize()} symbols cached, still fresh`);
    }
  }

  if (wantPrices) {
    // Sample positions are skipped: their fictional price path is internally
    // consistent with the fills in the story, and real closes would contradict it.
    const positions = db
      .prepare("select id, ticker, name from positions where demo=0 order by ticker")
      .all() as Array<{ id: string; ticker: string; name: string }>;
    const demoCount = (
      db.prepare("select count(*) as n from positions where demo=1").get() as { n: number }
    ).n;
    if (positions.length === 0) {
      console.log(
        demoCount > 0
          ? `prices: nothing to fetch — all ${demoCount} positions are sample data`
          : "prices: no positions yet"
      );
    }
    for (const p of positions) {
      process.stdout.write(`prices: ${p.ticker.padEnd(6)} `);
      try {
        const { stored, range } = await syncPrices(p.id, p.ticker, { full });
        console.log(`${String(stored).padStart(4)} bars (${range})`);
      } catch (err) {
        // A delisted, renamed or fictional symbol is expected in a demo book.
        console.log(`skipped — ${String(err).slice(0, 90)}`);
      }
    }
  }

  if (wantPrices) {
    // Real daily history per *symbol*, kept separate from any position's marks.
    // The correlation check samples it weekly; signal grading needs it daily;
    // both read the same sym_* series. The tracked set is the union of held
    // tickers, belief proxies, the universe, and the benchmark.
    const { added, total } = ensureUniverse();
    resolveCiks();
    console.log(`universe: ${total} tracked symbols${added ? ` (+${added} new from the list)` : ""}`);

    const symbols = [
      ...new Set([BENCHMARK, ...symbolsToTrack(), ...listUniverse().map((u) => u.symbol)]),
    ];
    const recent = new Date(Date.now() - 90 * 86_400_000).toISOString();
    const dailyCount = db.prepare(
      "select count(*) as n from marks where positionId=? and occurredAt>=?"
    );
    for (const sym of symbols) {
      process.stdout.write(`series: ${sym.padEnd(8)} `);
      try {
        const seriesId = symbolSeriesId(sym);
        // A series with fewer than ~40 marks in 90 days is weekly-only or new —
        // backfill it to daily once; after that a cheap top-up suffices.
        const sparse = (dailyCount.get(seriesId, recent) as { n: number }).n < 40;
        const { stored, range } = await syncPrices(seriesId, sym, { full: full || sparse });
        console.log(`${String(stored).padStart(4)} bars (${range})`);
      } catch (err) {
        console.log(`skipped — ${String(err).slice(0, 80)}`);
      }
    }
    const purged = dedupeSymbolDays();
    if (purged > 0) console.log(`series: purged ${purged} stale duplicate-date bars`);
  }

  if (wantFilings) {
    const withCik = db
      .prepare("select id, ticker, portfolioId, cik from positions where demo=0 and cik is not null")
      .all() as Array<{ id: string; ticker: string; portfolioId: string; cik: string }>;
    if (withCik.length === 0) {
      console.log("filings: no positions carry a CIK yet — pick a security from the search to attach one");
    }
    for (const p of withCik) {
      process.stdout.write(`filings: ${p.ticker.padEnd(6)} `);
      try {
        const { evidence, estimated } = await syncFilings(p.id, p.portfolioId, p.ticker, p.cik);
        console.log(
          `${String(evidence).padStart(3)} new` +
            (estimated
              ? `, next report est. ${estimated.nextAt.slice(0, 10)} (median ${estimated.medianGapDays}d over ${estimated.basedOn})`
              : ", no cadence yet")
        );
      } catch (err) {
        console.log(`skipped — ${String(err).slice(0, 90)}`);
      }
    }
  }

  if (wantInsiders) {
    // One submissions fetch per universe company; each new Form 4 costs two
    // more archive requests. First sight of a company only seeds its watermark.
    const tracked = listUniverse().filter((u) => u.cik);
    const noCik = listUniverse().length - tracked.length;
    if (noCik > 0) console.log(`insiders: ${noCik} universe symbols have no CIK yet (ETFs, or universe refresh pending)`);
    const run = startRun("sec-universe", `${tracked.length} companies`);
    let seeded = 0, processed = 0, buys = 0, signals = 0, eightk = 0, failed = 0;
    for (const u of tracked) {
      try {
        const filings = await fetchFilings(u.cik!);
        const r = await syncInsiders(u.symbol, u.cik!, filings);
        if (r.seeded) seeded++;
        processed += r.processed;
        buys += r.buys;
        signals += r.signals;
        // 8-K event signals ride the same submissions fetch. Historical ones
        // arrive flagged backfilled — sample size for the studies, invisible
        // to the live scorecard.
        eightk += emitEightK(u.symbol, filings);
        if (r.signals > 0) console.log(`insiders: ${u.symbol.padEnd(6)} ${r.signals} signal(s) from ${r.buys} buy filing(s)`);
      } catch (err) {
        failed++;
        if (failed <= 3) console.log(`insiders: ${u.symbol.padEnd(6)} skipped — ${String(err).slice(0, 80)}`);
      }
    }
    const note = `${processed} new Form 4s, ${buys} qualifying buys, ${signals} insider signals, ${eightk} 8-K signals` +
      (seeded ? `, ${seeded} watermarks seeded` : "") + (failed ? `, ${failed} companies failed` : "");
    finishRun(run, failed < tracked.length, note);
    console.log(`insiders: ${note}`);
  }

  // Monitors run after prices: they read the series that were just refreshed.
  const transitions = evaluateMonitors();
  if (transitions.length === 0) {
    console.log("\nmonitors: no state changes");
  } else {
    console.log("");
    for (const t of transitions) {
      console.log(
        `monitor ${t.direction === "fired" ? "FIRED " : "cleared"} ${t.monitor.label} — ${t.describe}`
      );
    }
  }

  // Grade signals whose horizons have now fully elapsed. Append-only: an
  // existing outcome is never revisited, a pending one writes nothing.
  const graded = computeOutcomes();
  console.log(
    `outcomes: ${graded.graded} newly graded, ${graded.pending} awaiting their horizon, ${graded.ungraded} ungradeable`
  );

  const runs = db
    .prepare("select source, ok, note from ingest_runs order by startedAt desc limit 5")
    .all() as Array<{ source: string; ok: number | null; note: string | null }>;
  console.log("\nlast runs:");
  for (const r of runs) {
    console.log(`  ${r.ok === 1 ? "ok  " : "fail"} ${r.source.padEnd(14)} ${r.note ?? ""}`);
  }
}

main().catch((err) => {
  console.error(String(err));
  process.exit(1);
});
