# AsOf

**A decision record for investors.** Most tools show you prices, charts and returns. AsOf records what you knew, believed, expected and decided at each point in time — then helps you manage the book and review your own judgment without hindsight.

Runs entirely on your machine. No accounts, no API keys, no market feed, no network calls.

```bash
npm install
npm run dev          # http://localhost:3000 — seeds a demo book on first run
```

---

## What it does

**Positions carry a living thesis, and an untouchable record of what it used to say.** The main claim, what the market believes, what you believe differently, the assumptions the position rests on, what would prove it wrong, and the conditions under which you would add, trim or exit. Updating a thesis writes a new version alongside the old one — there is no edit path, by design.

**Decisions capture the reasoning while you still don't know the answer.** What you did, why, what you expect, your confidence, the main risk, and what would make you reverse it. Later you record how it actually resolved, which is what makes everything on the Patterns page possible.

**Events are prepared before the headline.** What the market expects, what you expect, the variables that will actually decide it, and bull/base/bear scenarios each with an action chosen in advance. Afterwards AsOf holds your expectation next to what happened and asks four questions the price cannot answer: was your forecast accurate, did you name the right variables, did you follow your own plan, and was the market reaction itself a surprise.

**Beliefs reveal what the book is really betting on.** Positions link to underlying risk drivers, so a chip designer, a nuclear utility, a copper miner and a data-centre REIT show up as what they are — largely one bet expressed four ways. A sector chart cannot show you that.

**It answers back while you are deciding, not after.** Choose a position and an action on the decision form and AsOf tells you what your own record says about that combination before you have written a word: the rule you wrote for this position, your base rate for that action, anything currently firing, and a catalyst you already have a plan for. Choosing "hold" on a position whose exit condition is already satisfied says so, and quotes the sentence. Rules only, no model, and nothing that tells you what to do.

**Falsifiers can fire on their own.** A condition written as prose waits for you to notice it. Bind it to something observable — a price level, a drawdown from a window high, a move in the 10-year yield or copper, a date going by — and it watches itself. When one crosses, it writes an ordinary piece of evidence against the assumption it speaks for, carrying the sentence you wrote about what crossing would mean. That shape is deliberate: the timeline, the attention queue and the "not revisited since" logic all work on it without knowing monitors exist. Only a change of state is recorded, so a condition that stays met stays quiet.

**And then the tape checks your work.** The belief matrix is your *model* of what connects your positions. Beside it, AsOf computes the realised weekly-return correlation between the same holdings and asks where the two disagree: a belief you declared that the prices never showed, two holdings moving together for a reason you never wrote down, or a stated macro exposure that is not visible at all. On the sample book it confirms the data-centre cluster and refutes one line of a thesis — DLR describes itself as "a levered short on long rates" while correlating about −0.05 with the 10-year yield over two years. Correlation is read from real prices for the symbol rather than from your own fills, because how two securities move together is a property of the market, not of your execution. Findings are withheld below 40 shared weeks rather than hedged.

**Replay is the signature feature.** Pick a past decision. AsOf rebuilds the portfolio as it stood, hides everything that came afterwards — including what you actually chose and how it turned out — and asks you to decide again. Then it shows both answers side by side, what happened next, and a list of everything that arrived after the decision, so you can check whether your new answer quietly used it.

**Postmortems refuse to collapse into win or lose.** Six separate verdicts: was the thesis right, the valuation, the sizing, the timing, did you follow your process, and was the result skill, luck or an outside event. A good decision can lose money and a bad one can make it; the useful information is in where the answers disagree.

**Real securities, real prices.** Symbol lookup runs over ~10,400 tickers cached from SEC's published ticker file, so picking a company fills in its name and carries its CIK. Creating that position backfills five years of daily closes from Yahoo, which is what makes returns, weights and the price paths real rather than typed. Free text still works — an unlisted symbol, a private holding, or an offline machine is never a dead end. Both sources are free and need no API key.

The sample book is the exception: its price path is fictional but internally consistent with the fills in its story, so ingestion deliberately skips it. Mixing a real close into it would put a $62 fill next to a real $110 mark on the same day.

**The attention queue surfaces tension without ruling on it.** Evidence standing against an assumption you have not revisited since. Catalysts that passed with no outcome recorded. A thesis whose assumptions are mostly no longer intact. One event that reaches four positions. Every item ends in a question rather than a verdict — AsOf does not know whether your thesis is right, only that something has changed and you have not said either way.

## How it is built

Everything is a timestamped, append-only record, and every read takes an optional `asOf` bound. Rendering the app at a past moment is the same code path as rendering it now, with a different bound — which is what makes Replay honest rather than decorative. That single convention lives in `src/lib/queries.ts`.

The "intelligence" is deterministic: the attention queue and the pattern cards are rules computed over your own structured records, and each pattern names the decisions it came from so you can disagree with it. No model is called, nothing is sent anywhere, and a pattern card only appears if its rule actually fires on your history.

| | |
|---|---|
| Stack | Next.js 16 (App Router), TypeScript, Tailwind CSS 4 |
| Storage | SQLite via better-sqlite3, plain SQL, at `data/asof.db` (gitignored) |
| Writes | Server actions in `src/lib/actions.ts` — validated server-side |
| Layout | `src/lib/queries.ts` reads · `src/lib/seed.ts` demo book · `src/components` UI |

## Commands

```bash
npm run dev                 # dev server, seeds on first run
npm run build && npm start  # production
npm test                    # both suites below
npm run test:asof           # as-of correctness: bounds, thesis versioning, the Replay seal
npm run test:ingest         # parsers, filing cadence and correlation, against recorded fixtures
npm run seed -- --force     # rebuild the demo book from scratch
npm run fixtures            # re-record the fixtures (the only thing needing network)
npm run check:console       # loads all 30 routes, fails on any console error or warning
npm run check:flow          # drives the whole decision loop in a real browser
npm run ingest              # symbol universe, prices, filings, then evaluate monitors
npm run ingest -- --full    # 5-year price backfill rather than a top-up
npm run check:qa            # regression checks for previously-reported defects
```

Ingestion talks to two free, keyless sources: SEC for the ticker universe and filings, Yahoo for daily closes. Requests are serialised and rate-limited, every attempt is recorded in the `ingest_runs` table, and a network failure can never break a page render — the position simply keeps the price you entered.

SEC asks that automated requests identify themselves with a contact address, and enforces it (a User-Agent carrying a URL is refused with 403). The default is a generic placeholder; if you use this regularly, set your own in `.env.local`:

```
ASOF_USER_AGENT=AsOf/0.1 (you@example.com)
```

`npm test` needs nothing but Node. The two `check:` scripts drive a real browser against a running dev server, so they need `npx playwright install chromium` once. `check:flow` writes to your database — run `npm run seed -- --force` afterwards to restore the demo book.

`npm test` is the one that matters: if the as-of bound leaks, Replay is a lie. It asserts that nothing dated after a decision reaches its sealed context, that thesis versions resolve to the version in force on a date, and that outcomes stay hidden until they existed.

Neither suite touches the network. `test:ingest` runs against trimmed real responses recorded in `scripts/fixtures/` (~40 KB, public market and filing data), so a provider being slow or down never fails a test for reasons unrelated to the code. Re-record with `npm run fixtures` if a provider changes shape.

## The demo book

The seeded portfolio is fictional — a concentrated long-only book with a nuclear utility, a copper miner, a data-centre REIT and a chip designer that turn out to be one position on data-centre capex; a consumer name with evidence sitting against an unreviewed assumption; a closed position whose postmortem concludes the process held and the outcome did not; and an idea that was passed on, looked wrong for four months, then looked right.

Tickers are real, everything else is invented, and prices are illustrative rather than quotes. Dates are relative to when you seed, so the demo never goes stale.

## Keeping it current

Monitors are only honest if something checks them. On Windows:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\win\install-task.ps1
```

That registers a daily task (plus one shortly after logon, so a machine that was off catches up) which refreshes prices and filings and then evaluates every monitor. It runs through a VBScript launcher so no console window ever appears, and appends to `data/ingest.log`. Remove it with `-Remove`.

## The optional model

One feature uses a language model: reading a pasted document against a thesis and saying which assumptions it actually speaks to. Every number, monitor, correlation and pattern in AsOf is computed without one and is unaffected by whether it is configured.

Put a key in `.env.local`, which is gitignored:

```
ANTHROPIC_API_KEY=sk-ant-...        # or OPENAI_API_KEY=sk-...
ASOF_AI_MODEL=anthropic:claude-sonnet-4-5   # optional
```

Without a key the feature is hidden and everything else is unchanged. Naming a provider whose key is missing disables it rather than silently using the other one. What gets sent is the text you paste, your thesis summary and your assumption list — not your holdings, returns or decisions — and only when you press the button. Anything it writes is marked as drafted, is editable, and a returned assumption id that isn't in your thesis is discarded rather than stored.

## Notes

Single user, no authentication — it binds to localhost and is not built to be exposed. Your database lives in `data/` and is gitignored; nothing in this repo contains portfolio data. Adding a price feed or a model behind an env var would both slot in without touching the data model, but neither is here.
