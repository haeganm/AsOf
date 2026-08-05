import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

// ponytail: plain SQL over better-sqlite3. The schema is fixed and single-user
// local, so an ORM + migration tool would earn nothing. All reads/writes funnel
// through queries.ts / actions.ts, which is where types get applied.

const DDL = `
create table if not exists portfolios (
  id text primary key,
  name text not null,
  description text,
  createdAt text not null
);

create table if not exists positions (
  id text primary key,
  portfolioId text not null,
  ticker text not null,
  name text not null,
  assetClass text,
  status text not null,
  openedAt text,
  closedAt text,
  createdAt text not null
);

create table if not exists lots (
  id text primary key,
  positionId text not null,
  occurredAt text not null,
  deltaShares real not null,
  price real not null,
  note text
);

create table if not exists marks (
  id text primary key,
  positionId text not null,
  occurredAt text not null,
  price real not null
);

create table if not exists thesis_versions (
  id text primary key,
  positionId text not null,
  versionNo integer not null,
  occurredAt text not null,
  summary text not null,
  marketView text,
  variantView text,
  assumptions text not null default '[]',
  catalysts text not null default '[]',
  risks text not null default '[]',
  falsifiers text not null default '[]',
  horizon text,
  addCondition text,
  trimCondition text,
  exitCondition text,
  confidence integer not null,
  changeNote text,
  createdAt text not null
);

create table if not exists decisions (
  id text primary key,
  portfolioId text not null,
  positionId text,
  occurredAt text not null,
  type text not null,
  what text not null,
  why text not null,
  expectation text,
  confidence integer not null,
  mainRisk text,
  reversalTrigger text,
  linkedEventId text,
  outcomeAt text,
  outcomeNote text,
  outcomeVerdict text,
  createdAt text not null
);

create table if not exists evidence (
  id text primary key,
  positionId text not null,
  occurredAt text not null,
  kind text not null,
  source text,
  title text not null,
  body text,
  stance text not null default 'neutral',
  contradictsAssumptionId text,
  createdAt text not null
);

create table if not exists events (
  id text primary key,
  portfolioId text not null,
  positionId text,
  title text not null,
  kind text,
  occurredAt text not null,
  knownAt text not null,
  status text not null,
  marketExpects text,
  iExpect text,
  keyVariables text not null default '[]',
  scenarios text not null default '[]',
  outcome text,
  resolvedAt text,
  createdAt text not null
);

create table if not exists beliefs (
  id text primary key,
  name text not null,
  description text,
  stance text,
  confidence integer,
  createdAt text not null
);

-- occurredAt is load-bearing: without it a belief link created today renders
-- inside a Replay room sealed to a past date, which is the one thing the
-- product must never do.
create table if not exists position_beliefs (
  id text primary key,
  positionId text not null,
  beliefId text not null,
  relationship text,
  sensitivity text not null,
  occurredAt text not null default '1970-01-01T00:00:00.000Z',
  createdAt text not null default '1970-01-01T00:00:00.000Z'
);

create table if not exists event_beliefs (
  id text primary key,
  eventId text not null,
  beliefId text not null,
  occurredAt text not null default '1970-01-01T00:00:00.000Z'
);

create table if not exists postmortems (
  id text primary key,
  positionId text not null,
  decisionId text,
  occurredAt text not null,
  verdicts text not null default '{}',
  lesson text,
  processChange text,
  createdAt text not null
);

create table if not exists replay_attempts (
  id text primary key,
  decisionId text not null,
  createdAt text not null,
  newChoice text not null,
  newReasoning text,
  newConfidence integer,
  hindsightNote text
);

`;

/** Applied after `migrate`, because some of these index the added columns. */
const INDEXES = `
create index if not exists idx_lots_pos on lots(positionId, occurredAt);
create index if not exists idx_marks_pos on marks(positionId, occurredAt);
create index if not exists idx_thesis_pos on thesis_versions(positionId, occurredAt);
create index if not exists idx_evidence_pos on evidence(positionId, occurredAt);
create index if not exists idx_decisions_pos on decisions(positionId, occurredAt);
create index if not exists idx_pb_pos on position_beliefs(positionId, occurredAt);
create index if not exists idx_eb_ev on event_beliefs(eventId, occurredAt);

-- A duplicate link would double-count a position's value in belief exposure and
-- push a belief's share of the book above 100%.
create unique index if not exists uq_pb on position_beliefs(positionId, beliefId);
create unique index if not exists uq_eb on event_beliefs(eventId, beliefId);
create unique index if not exists uq_thesis_ver on thesis_versions(positionId, versionNo);
create unique index if not exists uq_marks on marks(positionId, occurredAt);
`;

/**
 * Columns added after the first release. SQLite has no "add column if not
 * exists", so each is attempted and its duplicate-column error swallowed —
 * cheaper and safer than a migration framework for a local single-user file.
 */
const ADDED_COLUMNS: Array<[string, string, string]> = [
  ["position_beliefs", "occurredAt", "text not null default '1970-01-01T00:00:00.000Z'"],
  ["position_beliefs", "createdAt", "text not null default '1970-01-01T00:00:00.000Z'"],
  ["event_beliefs", "occurredAt", "text not null default '1970-01-01T00:00:00.000Z'"],
];

function migrate(db: Database.Database) {
  for (const [table, column, decl] of ADDED_COLUMNS) {
    try {
      db.exec(`alter table ${table} add column ${column} ${decl}`);
    } catch (err) {
      if (!/duplicate column/i.test(String(err))) throw err;
    }
  }
}

let cached: Database.Database | null = null;

export function getDb(): Database.Database {
  if (cached) return cached;

  // ASOF_DB_FILE lets the test suite point the query layer at a throwaway db.
  const file = process.env.ASOF_DB_FILE ?? path.join(process.cwd(), "data", "asof.db");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  cached = configure(new Database(file));
  // An empty book must render, not 500. Seeding the demo is separate and lives
  // in `npm run seed` (wired to predev/prestart).
  ensurePortfolio(cached);
  return cached;
}

/** Open a DB at an explicit path with the schema applied but no auto-seed. Used by scripts/tests. */
export function openDb(file: string): Database.Database {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  return configure(new Database(file));
}

/** Single place where connection settings live, so tests match production. */
function configure(db: Database.Database): Database.Database {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  // Two writers (a dev server and `npm run seed`) otherwise throw SQLITE_BUSY
  // straight out of a server action.
  db.pragma("busy_timeout = 5000");
  db.exec(DDL);
  migrate(db);
  db.exec(INDEXES);
  return db;
}

/** The app is single-portfolio; guarantee the row exists so reads cannot be undefined. */
export function ensurePortfolio(db: Database.Database): string {
  const row = db.prepare("select id from portfolios limit 1").get() as { id: string } | undefined;
  if (row) return row.id;
  const id = newId("pf");
  db.prepare("insert into portfolios (id,name,description,createdAt) values (?,?,?,?)").run(
    id,
    "My Book",
    null,
    nowIso()
  );
  return id;
}

/** Releases the cached connection. Windows will not unlink an open db file. */
export function closeDb() {
  cached?.close();
  cached = null;
}

export function resetDb(db: Database.Database) {
  const tables = [
    "portfolios",
    "positions",
    "lots",
    "marks",
    "thesis_versions",
    "decisions",
    "evidence",
    "events",
    "beliefs",
    "position_beliefs",
    "event_beliefs",
    "postmortems",
    "replay_attempts",
  ];
  for (const t of tables) db.exec(`delete from ${t}`);
}

export function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().slice(0, 12)}`;
}

export function nowIso() {
  return new Date().toISOString();
}
