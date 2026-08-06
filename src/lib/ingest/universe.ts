import fs from "node:fs";
import path from "node:path";
import { getDb, nowIso } from "../db";

/**
 * The tracked universe: which symbols the automatic sources (daily prices,
 * filings, insider trades) watch. Seeded once from the committed default list;
 * after that the table is the truth and the user edits it by editing the file
 * and re-running ingest (new symbols are added, never removed — history for a
 * symbol you stopped tracking is still history).
 */

const DEFAULT_FILE = path.join(process.cwd(), "data-static", "universe-default.txt");

export function readUniverseFile(file = DEFAULT_FILE): string[] {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf-8")
    .split(/\r?\n/)
    .map((l) => l.trim().toUpperCase())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
}

/** Sync the universe table with the file; returns how many symbols were added. */
export function ensureUniverse(): { added: number; total: number } {
  const db = getDb();
  const symbols = readUniverseFile();
  const insert = db.prepare(
    `insert into universe (symbol, cik, name, active, addedAt)
     values (?,
             (select cik from securities where ticker = ?),
             (select name from securities where ticker = ?),
             1, ?)
     on conflict(symbol) do nothing`
  );
  let added = 0;
  db.transaction(() => {
    for (const sym of symbols) {
      if (insert.run(sym, sym, sym, nowIso()).changes > 0) added++;
    }
  })();
  const total = (db.prepare("select count(*) as n from universe where active=1").get() as { n: number }).n;
  return { added, total };
}

export interface UniverseRow {
  symbol: string;
  cik: string | null;
  name: string | null;
  active: number;
  form4Watermark: string | null;
  addedAt: string;
}

export function listUniverse(): UniverseRow[] {
  return getDb().prepare("select * from universe where active=1 order by symbol").all() as UniverseRow[];
}

/** Backfill CIKs for universe rows added before the securities cache existed. */
export function resolveCiks(): number {
  return getDb()
    .prepare(
      `update universe set cik = (select cik from securities where ticker = universe.symbol),
                          name = coalesce(name, (select name from securities where ticker = universe.symbol))
       where cik is null and exists (select 1 from securities where ticker = universe.symbol)`
    )
    .run().changes;
}
