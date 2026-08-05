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
import { syncPrices } from "../src/lib/ingest/prices";

const argv = process.argv.slice(2);
const only = (flag: string) => argv.includes(flag);
const wantUniverse = only("--universe") || (!only("--prices") && true);
const wantPrices = only("--prices") || !only("--universe");
const full = only("--full");

async function main() {
  const db = getDb();

  if (wantUniverse) {
    if (needsRefresh() || only("--universe")) {
      process.stdout.write("universe: fetching SEC ticker file… ");
      try {
        const { count, skipped } = await refreshUniverse(only("--universe"));
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
