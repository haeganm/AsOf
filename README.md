# AsOf

[![CI](https://github.com/haeganm/AsOf/actions/workflows/ci.yml/badge.svg)](https://github.com/haeganm/AsOf/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**A self-grading market intelligence engine.** AsOf collects signals — insider buys from SEC filings, company events, your own monitors and decisions, alerts from any tool you already run — seals each one at the moment it became publicly knowable, and then grades it: what did the stock actually do afterwards, compared to just holding the index?

Three questions, three pages:

- **Scorecard** — *of everything shouting at me, what has actually worked?* Every signal source graded the same way, with honest sample sizes and confidence ranges, and "not enough data yet" said out loud instead of dressed up.
- **Studies** — *what usually happens after events like this?* A CEO departure, a cluster of insider buys, a results filing — each event class carries the market's track record across every instance on file.
- **Today** — *what fired since yesterday?* Each new arrival lands with its class's historical base rate beside it, so a headline arrives already wearing its context.

Runs entirely on your machine, on free keyless data. No accounts, no API keys, no fees.

```bash
npm install
npm run dev          # http://localhost:3000 — seeds a demo book on first run
npm run ingest       # collect: prices, filings, insider buys, monitors, inbox
```

---

## How it stays honest

Every graded number in AsOf survives four rules, because a self-grading system that flatters itself is worse than none:

1. **Sealed at the knowable instant.** A signal is stamped with `knownAt` — for SEC filings, the exact acceptance timestamp — and appended once, immutably. Grading assumes the only entry a human could have made: the close of the first trading day that ended *after* the fact was public. A filing accepted at 4:29 pm is graded from the *next* day's close.
2. **Always versus the index.** Returns are measured at 5, 20 and 60 trading days *minus SPY over the same days*. In a rising market everything looks smart; the only fair question is whether the signal beat simply holding the index.
3. **Imported history can never prove an edge.** Backfilled signals (loaded after the fact) power the Studies — sample size is their whole point — but are permanently excluded from the Scorecard, which grades only what was collected live and sealed before the outcome existed.
4. **Withheld, not hedged.** Below a minimum sample, a row is greyed out and says it is collecting — no precise-looking number on seven data points. A standing note explains that with many sources and horizons, some rows will look good by luck.

Grades are written once, when the horizon has fully elapsed, and never revised. A symbol that stopped trading before its horizon, or a signal older than the available price history, is counted as "ungraded", not silently dropped or entered years late.

## Where signals come from

| Source | What arrives | Cost |
|---|---|---|
| **SEC Form 4** | Open-market insider buys — a large single buy (≥ $250k), or two-plus distinct insiders buying within 14 days | Free, keyless |
| **SEC 8-K** | Material company events by item: leadership change, results, material agreement, bankruptcy, auditor change, restatement, listing deficiency, completed acquisition | Free, keyless |
| **Your monitors** | Conditions you bound to observables (price levels, drawdowns, macro series) firing on their own | Free |
| **Your journal** | Every decision you record is also a signal — your own judgment lands on the same scorecard as everything else | — |
| **The inbox** | Any local tool can drop `*.jsonl` files into `data/inbox/` and get graded like everything else | — |

The automatic sources watch a ~100-name universe of liquid US large caps, defined in `data-static/universe-default.txt` — edit it freely; your own positions are always tracked on top. Daily closes come from Yahoo; five years are backfilled per symbol, with SPY as the benchmark.

### The inbox format

One JSON object per line, in any `.jsonl` file dropped into `data/inbox/`:

```json
{"source":"myscanner","symbol":"NVDA","kind":"orb_breakout","direction":"long","firedAt":"2026-08-06T09:35:00-04:00"}
```

Required: `source`, `symbol`, `kind`, `direction` (`long` | `short` | `info`), `firedAt` (ISO 8601, any offset). Optional: `knownAt`, `title`, `detail`, `externalId`, `meta`. Files are archived after the sweep; re-drops dedupe; malformed lines are counted and reported. A signal imported days after it fired is auto-flagged as backfilled and stays off the live scorecard — producers that want live grades drop their files promptly.

## The journal

AsOf began as a decision record, and that whole app is still here under **Journal**: positions carrying living theses with an untouchable version history, decisions captured with reasoning and confidence before the outcome is known, events prepared with scenarios before the headline, beliefs revealing what the book really bets on (checked against realised correlation), postmortems with six separate verdicts, and **Replay** — pick a past decision, see the world rebuilt exactly as it stood with everything afterwards sealed, and decide again.

The journal is what makes the engine personal: your decisions are one signal source among several, and pages like Patterns and the decision-time nudges read your own record back to you.

## How it is built

Everything is a timestamped, append-only record, and every read takes an optional `asOf` bound. Rendering the app at a past moment is the same code path as rendering it now — which is what makes Replay honest and signal-sealing structural rather than decorative.

All grading is deterministic — plain arithmetic over stored prices, reproducible by hand from the database. No model is called and nothing leaves the machine.

| | |
|---|---|
| Stack | Next.js 16 (App Router), TypeScript, Tailwind CSS 4 |
| Storage | SQLite via better-sqlite3, plain SQL, at `data/asof.db` (gitignored) |
| Grading | `src/lib/grade.ts` (pure maths) · `src/lib/signals.ts` (the spine) |
| Collection | `src/lib/ingest/` — one file per source |
| Journal | `src/lib/queries.ts` reads · `src/lib/actions.ts` writes · `src/lib/seed.ts` demo book |

## Commands

```bash
npm run dev                 # dev server, seeds on first run
npm run build && npm start  # production
npm test                    # both offline suites (as-of correctness + ingest/grading)
npm run ingest              # universe, prices, filings, insiders, 8-Ks, inbox, monitors, grades
npm run ingest -- --full    # 5-year price backfill rather than a top-up
npm run seed -- --force     # rebuild the demo book (live-collected signals survive)
npm run fixtures            # re-record API fixtures (the only thing needing network)
npm run check:console       # loads all routes, fails on any console error or warning
npm run check:flow          # drives the whole decision loop in a real browser
npm run check:qa            # regression checks for previously-reported defects
```

`npm test` needs nothing but Node — both suites run against recorded fixtures in `scripts/fixtures/` (~40 KB of public market and filing data), so a provider being slow never fails a test for reasons unrelated to the code.

SEC asks that automated requests identify themselves with a contact address, and enforces it. The default is a generic placeholder; if you use this regularly, set your own in `.env.local`:

```
ASOF_USER_AGENT=AsOf/0.1 (you@example.com)
```

## Keeping it current

The engine is only alive if something runs it daily. On Windows:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\win\install-task.ps1
```

That registers a daily task (plus one shortly after logon, so a machine that was off catches up) which refreshes prices and filings, checks for new insider buys and 8-Ks, sweeps the inbox, evaluates every monitor, and writes grades for horizons that have elapsed. It runs through a VBScript launcher so no console window appears, and appends to `data/ingest.log`. Remove it with `-Remove`.

## The demo book

The seeded journal is fictional — a concentrated book whose story exercises every feature: four holdings that turn out to be one bet on data-centre capex, evidence standing against an unreviewed assumption, a closed position whose postmortem concludes the process held and the outcome did not. Tickers are real, everything else is invented, and ingestion deliberately skips demo positions so real closes never contradict the story's prices. Live-collected signals survive a reseed — scorecard history is irreplaceable.

## The optional model

One feature uses a language model: reading a pasted document against a thesis. Every number, grade, study and pattern is computed without it. Put a key in `.env.local` (`ANTHROPIC_API_KEY=...` or `OPENAI_API_KEY=...`) and the feature appears; without one it is hidden and nothing else changes. What you paste is all that is sent, only when you press the button, and anything the model drafts is marked as drafted and editable.

## Notes

Single user, no authentication — binds to localhost and is not built to be exposed. Your database lives in `data/` and is gitignored; nothing in this repo contains portfolio data. The committed universe file contains only public tickers.
