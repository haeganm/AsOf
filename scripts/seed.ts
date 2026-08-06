import path from "node:path";
import { openDb } from "../src/lib/db";
import { seedDatabase } from "../src/lib/seed";
import { evaluateMonitors } from "../src/lib/monitors";

const force = process.argv.includes("--force");
const file = path.join(process.cwd(), "data", "asof.db");
const db = openDb(file);

const { n } = db.prepare("select count(*) as n from portfolios").get() as { n: number };
if (n > 0 && !force) {
  console.log("AsOf: database already has data — skipping seed. Use `npm run seed -- --force` to rebuild it.");
} else {
  seedDatabase(db);
  const counts = ["positions", "decisions", "thesis_versions", "evidence", "events", "beliefs"]
    .map((t) => `${(db.prepare(`select count(*) as n from ${t}`).get() as { n: number }).n} ${t}`)
    .join(", ");
  console.log(`AsOf: seeded demo book — ${counts}.`);

  // Seeded monitors start clear. Evaluating them now means a freshly seeded book
  // shows the true current state of every condition rather than waiting for the
  // next scheduled refresh — and the cached symbol series survives a reseed, so
  // this needs no network.
  const fired = evaluateMonitors().filter((t) => t.direction === "fired");
  if (fired.length > 0) {
    for (const t of fired) console.log(`  monitor already met: ${t.monitor.label} — ${t.describe}`);
  }
}
db.close();
