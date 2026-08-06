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
  createdAt text not null,
  cik text,
  demo integer not null default 0
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

-- The investable universe, cached from SEC's published ticker file so symbol
-- lookup works offline and every position can carry a CIK for filings.
create table if not exists securities (
  ticker text primary key,
  cik text,
  name text not null,
  exchange text,
  kind text,
  updatedAt text not null
);

-- One row per ingestion attempt, so a silent failure is still visible.
create table if not exists ingest_runs (
  id text primary key,
  source text not null,
  target text,
  startedAt text not null,
  finishedAt text,
  ok integer,
  note text
);

-- Binds a written claim to something observable, so a falsifier can fire on its
-- own instead of waiting to be noticed. A firing writes ordinary ingested
-- evidence, which means every downstream feature — timeline, attention queue,
-- thesis-update prompt — works on it unchanged.
create table if not exists monitors (
  id text primary key,
  positionId text,
  assumptionId text,
  beliefId text,
  kind text not null,
  symbol text not null,
  comparator text not null,
  threshold real not null,
  windowDays integer,
  label text not null,
  meaning text,
  state text not null default 'clear',
  lastValue real,
  lastCheckedAt text,
  firedAt text,
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

-- The signal spine. A signal is any timestamped, sealed claim that something
-- notable happened for a symbol: an insider cluster buy, an 8-K, a monitor
-- firing, an imported alert, one of your own decisions. Grading always keys off
-- knownAt (when it became publicly knowable), never firedAt — and a row sealed
-- long after it was knowable carries backfilled=1 so the scorecard can refuse it.
create table if not exists signals (
  id text primary key,
  source text not null,
  kind text not null,
  symbol text not null,
  direction text not null default 'info',
  firedAt text not null,
  knownAt text not null,
  sealedAt text not null,
  backfilled integer not null default 0,
  title text not null,
  detail text,
  externalId text,
  meta text not null default '{}'
);

-- One row per (signal, horizon), written only once the horizon has fully
-- elapsed. An outcome row existing is itself the honesty guarantee: nothing is
-- graded early, and nothing is ever revised.
create table if not exists signal_outcomes (
  signalId text not null,
  horizonDays integer not null,
  entryAt text not null,
  exitAt text not null,
  signalReturn real not null,
  benchmarkReturn real not null,
  excessReturn real not null,
  computedAt text not null,
  primary key (signalId, horizonDays)
);

-- The tracked set for automatic sources (filings, insiders) and daily price
-- sync. Seeded from data-static/universe-default.txt; the user's own positions
-- are always implicitly tracked too.
create table if not exists universe (
  symbol text primary key,
  cik text,
  name text,
  active integer not null default 1,
  form4Watermark text,
  addedAt text not null
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

-- Ingestion is idempotent: re-reading a filing feed must not duplicate the
-- record. Not partial, because SQLite will not accept a partial index as an
-- ON CONFLICT target — and it does not need to be: SQLite treats NULLs as
-- distinct in a unique index, so any number of hand-written rows without an
-- external id coexist happily.
drop index if exists uq_evidence_ext;
drop index if exists uq_events_ext;
create unique index if not exists uq_evidence_extid on evidence(externalId);
create unique index if not exists uq_events_extid on events(externalId);
create unique index if not exists uq_signals_extid on signals(externalId);
create index if not exists idx_signals_source on signals(source, knownAt);
create index if not exists idx_signals_kind on signals(kind, knownAt);
create index if not exists idx_signals_symbol on signals(symbol, knownAt);
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
  ["positions", "cik", "text"],
  // Distinguishes what you wrote from what the engine found for you.
  ["evidence", "origin", "text not null default 'user'"],
  ["evidence", "externalId", "text"],
  ["events", "estimated", "integer not null default 0"],
  ["events", "externalId", "text"],
  // Sample positions carry an internally-consistent fictional price path. Mixing
  // real closes into it would put a $62 fill next to a real $110 mark on the same
  // day, so ingestion skips them.
  ["positions", "demo", "integer not null default 0"],
  // Distinguishes a price you typed from one that was fetched.
  ["marks", "source", "text not null default 'manual'"],
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
  // Cached market data is not book data. Reseeding the demo should not throw away
  // the symbol price series (`sym_*`) or the ticker universe and force a
  // re-download — those are expensive to fetch and identical for everyone.
  db.exec("delete from marks where positionId not like 'sym\\_%' escape '\\'");
  const tables = [
    "portfolios",
    "positions",
    "lots",
    "thesis_versions",
    "decisions",
    "evidence",
    "events",
    "beliefs",
    "position_beliefs",
    "event_beliefs",
    "postmortems",
    "replay_attempts",
    // A monitor is the user's own condition, so it belongs to the book and goes
    // with it. `securities` and `ingest_runs` are cached infrastructure and stay.
    "monitors",
  ];
  for (const t of tables) db.exec(`delete from ${t}`);
  // Signals collected live from the market (insiders, filings, imports) are
  // irreplaceable history — a scorecard that resets with the demo book is
  // worthless. Only book-owned signals (your decisions, your monitors) go with
  // the book they belonged to.
  db.exec("delete from signals where source in ('journal','monitor')");
  db.exec("delete from signal_outcomes where signalId not in (select id from signals)");
}

export function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().slice(0, 12)}`;
}

export function nowIso() {
  return new Date().toISOString();
}
