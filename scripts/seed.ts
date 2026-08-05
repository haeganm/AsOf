import path from "node:path";
import { openDb } from "../src/lib/db";
import { seedDatabase } from "../src/lib/seed";

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
}
db.close();
