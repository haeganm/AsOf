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
npm test                    # as-of correctness: bounds, thesis versioning, the Replay seal
npm run seed -- --force     # rebuild the demo book from scratch
npm run check:console       # loads all 30 routes, fails on any console error or warning
npm run check:flow          # drives the whole decision loop in a real browser
npm run ingest              # refresh the symbol universe, then top up prices
npm run ingest -- --full    # 5-year price backfill rather than a top-up
```

Ingestion talks to two free, keyless sources: SEC for the ticker universe and filings, Yahoo for daily closes. Requests are serialised and rate-limited, every attempt is recorded in the `ingest_runs` table, and a network failure can never break a page render — the position simply keeps the price you entered.

SEC asks that automated requests identify themselves with a contact address, and enforces it (a User-Agent carrying a URL is refused with 403). The default is a generic placeholder; if you use this regularly, set your own in `.env.local`:

```
ASOF_USER_AGENT=AsOf/0.1 (you@example.com)
```

`npm test` needs nothing but Node. The two `check:` scripts drive a real browser against a running dev server, so they need `npx playwright install chromium` once. `check:flow` writes to your database — run `npm run seed -- --force` afterwards to restore the demo book.

`npm test` is the one that matters: if the as-of bound leaks, Replay is a lie. It asserts that nothing dated after a decision reaches its sealed context, that thesis versions resolve to the version in force on a date, and that outcomes stay hidden until they existed.

## The demo book

The seeded portfolio is fictional — a concentrated long-only book with a nuclear utility, a copper miner, a data-centre REIT and a chip designer that turn out to be one position on data-centre capex; a consumer name with evidence sitting against an unreviewed assumption; a closed position whose postmortem concludes the process held and the outcome did not; and an idea that was passed on, looked wrong for four months, then looked right.

Tickers are real, everything else is invented, and prices are illustrative rather than quotes. Dates are relative to when you seed, so the demo never goes stale.

## Notes

Single user, no authentication — it binds to localhost and is not built to be exposed. Your database lives in `data/` and is gitignored; nothing in this repo contains portfolio data. Adding a price feed or a model behind an env var would both slot in without touching the data model, but neither is here.
