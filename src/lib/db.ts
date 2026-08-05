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

create table if not exists position_beliefs (
  id text primary key,
  positionId text not null,
  beliefId text not null,
  relationship text,
  sensitivity text not null
);

create table if not exists event_beliefs (
  id text primary key,
  eventId text not null,
  beliefId text not null
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

create index if not exists idx_lots_pos on lots(positionId, occurredAt);
create index if not exists idx_marks_pos on marks(positionId, occurredAt);
create index if not exists idx_thesis_pos on thesis_versions(positionId, occurredAt);
create index if not exists idx_evidence_pos on evidence(positionId, occurredAt);
create index if not exists idx_decisions_pos on decisions(positionId, occurredAt);
`;

let cached: Database.Database | null = null;

export function getDb(): Database.Database {
  if (cached) return cached;

  // ASOF_DB_FILE lets the test suite point the query layer at a throwaway db.
  const file = process.env.ASOF_DB_FILE ?? path.join(process.cwd(), "data", "asof.db");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(DDL);
  cached = db;
  // Seeding happens in `npm run seed`, wired to predev/prestart — so the app is
  // never empty on a fresh clone without dragging the seed into the bundle.
  return db;
}

/** Open a DB at an explicit path with the schema applied but no auto-seed. Used by scripts/tests. */
export function openDb(file: string): Database.Database {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.exec(DDL);
  return db;
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
