/**
 * Drives the real UI through the whole decision loop, because a form that
 * type-checks is not a form that works. Requires `npm run dev` on :3000.
 *
 *   npx tsx scripts/smoke.ts [--shots <dir>]
 *
 * This writes to the live database. Run `npm run seed -- --force` afterwards to
 * restore the demo book.
 */
import { chromium, type Page } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.ASOF_URL ?? "http://localhost:3000";
const shotsAt = process.argv.indexOf("--shots");
const SHOTS = shotsAt > -1 ? process.argv[shotsAt + 1] : null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

let passed = 0;
const failures: string[] = [];

async function step(label: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ok  ${label}`);
  } catch (err) {
    failures.push(`${label} — ${(err as Error).message}`);
    console.log(`  FAIL  ${label}\n        ${(err as Error).message}`);
  }
}

async function visit(page: Page, url: string, shot?: string) {
  const res = await page.goto(`${BASE}${url}`, { waitUntil: "domcontentloaded" });
  const status = res?.status() ?? 0;
  if (status !== 200) throw new Error(`${url} returned ${status}`);
  // innerText, not textContent — textContent includes <script> bodies, and Next
  // inlines its own 404 markup there.
  const body = await page.innerText("body");
  for (const bad of ["Application error", "This page could not be found", "NaN", "undefined"]) {
    if (body.includes(bad)) throw new Error(`${url} rendered “${bad}”`);
  }
  if (SHOTS && shot) {
    await page.screenshot({ path: path.join(SHOTS, `${shot}.png`), fullPage: true });
  }
  return body;
}

/**
 * Case-insensitive: the design uppercases section labels via CSS, and innerText
 * reports rendered text.
 */
const has = (body: string, needle: string, where: string) => {
  if (!body.toLowerCase().includes(needle.toLowerCase())) {
    if (SHOTS) {
      fs.writeFileSync(path.join(SHOTS, `fail-${where.replace(/\W+/g, "-")}.txt`), body);
    }
    throw new Error(`${where} is missing “${needle}”`);
  }
};

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

/**
 * Submits and waits for the *result* to appear. Waiting on the URL is useless
 * when the action redirects back to a path the browser already matches — it
 * resolves instantly against the pre-submit page.
 */
async function submit(page: Page, expect: string) {
  await page.click("[data-primary-submit]");
  await page.waitForFunction(
    (t) => document.body.innerText.toLowerCase().includes(t),
    expect.toLowerCase(),
    { timeout: 20_000 }
  );
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

  console.log("read paths");
  await step("dashboard", async () => {
    const b = await visit(page, "/", "01-dashboard");
    has(b, "Needs your judgment", "dashboard");
    has(b, "NVDA", "dashboard");
  });
  await step("positions index", () => visit(page, "/positions", "02-positions").then(() => {}));
  await step("position detail with thesis and timeline", async () => {
    const b = await visit(page, "/positions/pos_nvda", "03-position-nvda");
    has(b, "What has to be true", "position");
    has(b, "What this thesis used to say", "position");
  });
  await step("position under tension", async () => {
    const b = await visit(page, "/positions/pos_nke", "04-position-nke");
    has(b, "against your assumptions", "NKE");
  });
  await step("beliefs matrix", async () => {
    const b = await visit(page, "/beliefs", "05-beliefs");
    has(b, "of the book depends on", "beliefs");
  });
  await step("belief detail", () => visit(page, "/beliefs/bl_aicapex", "06-belief").then(() => {}));
  await step("event with outcome comparison", async () => {
    const b = await visit(page, "/events/ev_nke_q4", "07-event-resolved");
    has(b, "Read against your own plan", "event");
  });
  await step("event awaiting outcome", () => visit(page, "/events/ev_nvda_q3", "08-event-upcoming").then(() => {}));
  await step("patterns", async () => {
    const b = await visit(page, "/patterns", "09-patterns");
    has(b, "What this page cannot see", "patterns");
  });
  await step("postmortem", async () => {
    const b = await visit(page, "/postmortems/pm_pypl", "10-postmortem");
    has(b, "The verdict grid", "postmortem");
  });
  await step("decisions index", () => visit(page, "/decisions", "11-decisions").then(() => {}));
  await step("replay index hides the action taken", async () => {
    const b = await visit(page, "/replay", "12-replay-index");
    has(b, "Enter the room", "replay index");
    if (b.includes("Add 180 shares")) throw new Error("replay index leaks the original decision");
  });
  await step("replay room is sealed", async () => {
    const b = await visit(page, "/replay/dec_nvda_add", "13-replay-sealed");
    has(b, "Sealed", "replay room");
    for (const leak of ["Add 180 shares", "NIKE", "Digital Realty", "credit call"]) {
      if (b.includes(leak)) throw new Error(`sealed room leaks “${leak}”`);
    }
  });

  console.log("\nwrite paths");

  await step("the ticker picker finds a real security and prefills it", async () => {
    const found = await visit(page, "/positions/new?q=constellation", "14b-ticker-search");
    has(found, "CEG", "ticker search results");
    has(found, "Constellation", "ticker search results");
    // Choosing a match carries ticker, name and CIK into the form.
    await page.click('a[href*="ticker=CEG"]');
    await page.waitForFunction(
      () => (document.querySelector('[name="ticker"]') as HTMLInputElement)?.value === "CEG"
    );
    const cik = await page.inputValue('input[name="cik"]');
    if (!/^\d{10}$/.test(cik)) throw new Error(`expected a 10-digit CIK, got "${cik}"`);
    const name = await page.inputValue('[name="name"]');
    if (!/constellation/i.test(name)) throw new Error(`name not prefilled: "${name}"`);
  });

  let newPositionUrl = "";
  await step("create a position writes thesis v1 and an opening decision", async () => {
    await visit(page, "/positions/new", "14-position-new");
    await page.fill('[name="summary"]', "Smoke test: the constraint is supply, not demand.");
    await page.fill('[name="marketView"]', "The market sees a cycle.");
    await page.fill('[name="variantView"]', "I see an allocation regime.");
    await page.fill('[name="ticker"]', "SMOKE");
    await page.fill('[name="name"]', "Smoke Test Industries");
    await page.fill('[name="shares"]', "100");
    await page.fill('[name="price"]', "50");
    await page.fill('[name="occurredAt"]', daysAgo(40));
    await page.fill('[name="assumptions_new"]', "Margins hold above 40%.\nNo new supply before 2028.");
    await page.fill('[name="falsifiers"]', "Two quarters of margin compression on pricing.");
    await page.fill('[name="exitCondition"]', "A falsifier fires.");
    await page.locator('input[name="confidence"][value="4"]').check({ force: true });
    await Promise.all([page.waitForURL(/\/positions\/pos_/), page.click("[data-primary-submit]")]);
    newPositionUrl = new URL(page.url()).pathname;
    const b = await page.innerText("body");
    has(b, "SMOKE", "new position");
    has(b, "Margins hold above 40%", "new position");
    has(b, "$5,000", "new position");
  });

  await step("evidence against an assumption raises an attention item", async () => {
    await visit(page, `${newPositionUrl}/evidence`);
    await page.locator('input[name="kind"][value="fact"]').check({ force: true });
    await page.fill('[name="source"]', "Smoke 10-Q");
    await page.fill('[name="title"]', "Margin fell to 36% year on year");
    await page.fill('[name="body"]', "Management attributed it to pricing.");
    await page.locator('input[name="contradictsAssumptionId"][value="a1"]').check({ force: true });
    await submit(page, "Margin fell to 36%");
    const b = await page.innerText("body");
    has(b, "Margin fell to 36%", "position after evidence");
    has(b, "against your assumptions", "position after evidence");
    const dash = await visit(page, "/");
    has(dash, "SMOKE:", "dashboard attention queue");
  });

  await step("updating the thesis creates v2 and preserves v1", async () => {
    await visit(page, `${newPositionUrl}/thesis`, "15-thesis-update");
    await page.fill('[name="changeNote"]', "Margin assumption downgraded after the print.");
    await page.locator('input[name="asm_status_a1"][value="weakening"]').check({ force: true });
    await submit(page, "Margin assumption downgraded");
    const b = await page.innerText("body");
    has(b, "Thesis v2", "position after thesis update");
    has(b, "What this thesis used to say · 2 versions", "position after thesis update");
    has(b, "Margin assumption downgraded", "position after thesis update");
    has(b, "Smoke test: the constraint is supply", "v1 must remain readable");
  });

  let decisionUrl = "";
  await step("recording a decision moves the position size", async () => {
    await visit(page, `/decisions/new?position=${newPositionUrl.split("/").pop()}`, "16-decision-new");
    await page.locator('input[name="type"][value="reduce"]').check({ force: true });
    await page.fill('[name="what"]', "Trim 40 shares at $47 on the margin miss.");
    await page.fill('[name="why"]', "The assumption I sized for is weakening and I do not want to add.");
    await page.fill('[name="expectation"]', "No price view. This is a sizing action.");
    await page.fill('[name="mainRisk"]', "Cutting on one quarter of noise.");
    await page.fill('[name="reversalTrigger"]', "Margin recovers above 40% next quarter.");
    await page.fill('[name="shares"]', "40");
    await page.fill('[name="price"]', "47");
    await page.fill('[name="occurredAt"]', daysAgo(10));
    await Promise.all([page.waitForURL(/\/decisions\/dec_/), page.click("[data-primary-submit]")]);
    decisionUrl = new URL(page.url()).pathname;
    const b = await page.innerText("body");
    has(b, "Trim 40 shares", "decision detail");
    has(b, "The thesis this rested on", "decision detail");
    const pos = await visit(page, newPositionUrl);
    has(pos, "60 sh", "position size after the trim");
  });

  await step("closing the loop records an outcome", async () => {
    await visit(page, decisionUrl, "17-decision-detail");
    await page.locator('input[name="outcomeVerdict"][value="mixed"]').check({ force: true });
    await page.fill('[name="outcomeNote"]', "Right to reduce, wrong to reduce this much.");
    await submit(page, "Right to reduce");
    const b = await page.innerText("body");
    has(b, "Your verdict", "decision after outcome");
    has(b, "Right to reduce", "decision after outcome");
  });

  await step("replaying that decision reveals both answers", async () => {
    const sealed = await visit(page, `/replay/${decisionUrl.split("/").pop()}`);
    if (sealed.includes("Trim 40 shares")) throw new Error("sealed room leaks the decision text");
    if (sealed.includes("Right to reduce")) throw new Error("sealed room leaks the outcome");
    has(sealed, "What do you do?", "replay room");
    await page.locator('input[name="newChoice"][value="hold"]').check({ force: true });
    await page.fill(
      '[name="newReasoning"]',
      "One quarter is not my falsifier. Holding and waiting for the next print."
    );
    await page.locator('input[name="newConfidence"][value="3"]').check({ force: true });
    await Promise.all([page.waitForURL(/reveal=/), page.click("[data-primary-submit]")]);
    const b = await page.innerText("body");
    has(b, "What you decided then", "reveal");
    has(b, "What you decided now", "reveal");
    has(b, "Trim 40 shares", "reveal shows the original");
    has(b, "Things you could not have known", "reveal hindsight check");
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "18-replay-reveal.png"), fullPage: true });
  });

  await step("hindsight note saves", async () => {
    await page.fill('[name="hindsightNote"]', "Mostly hindsight — I know the margin number now.");
    await submit(page, "Mostly hindsight");
    has(await page.innerText("body"), "Mostly hindsight", "hindsight note");
  });

  let eventUrl = "";
  await step("preparing for an event then recording its outcome", async () => {
    await visit(page, "/events/new", "19-event-new");
    await page.fill('[name="title"]', "Smoke Test Industries Q3 results");
    await page.selectOption('[name="positionId"]', newPositionUrl.split("/").pop()!);
    await page.fill('[name="occurredAt"]', daysAgo(3));
    await page.fill('[name="marketExpects"]', "A soft quarter, guidance held.");
    await page.fill('[name="iExpect"]', "Margin flat, and the market to ignore the mix commentary.");
    await page.fill('[name="keyVariables"]', "Gross margin\nPricing commentary");
    await page.fill('[name="action_Bear"]', "Cut to a half position on confirmation.");
    await Promise.all([page.waitForURL(/\/events\/ev_/), page.click("[data-primary-submit]")]);
    eventUrl = new URL(page.url()).pathname;
    let b = await page.innerText("body");
    has(b, "Smoke Test Industries Q3", "event detail");
    has(b, "Cut to a half position", "event plan");

    await page.fill('[name="whatHappened"]', "Margin fell again and pricing was named on the call.");
    await page.fill('[name="actualReaction"]', "Down 9% on the day.");
    await page.locator('input[name="forecastAccurate"][value="no"]').check({ force: true });
    await page.locator('input[name="rightVariables"][value="yes"]').check({ force: true });
    await page.locator('input[name="followedPlan"][value="no"]').check({ force: true });
    await page.locator('input[name="reactionSurprising"][value="no"]').check({ force: true });
    await page.fill('[name="notes"]', "Named the variable, called it wrong, then did not act.");
    await submit(page, "Named the variable, called it wrong");
    b = await page.innerText("body");
    has(b, "Read against your own plan", "event after outcome");
    has(b, "You named the variable that mattered and got its resolution wrong", "event insight");
    has(b, "did something else", "followed-plan insight");
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "20-event-comparison.png"), fullPage: true });
  });

  await step("writing a postmortem", async () => {
    await visit(page, `${newPositionUrl}/postmortem`, "21-postmortem-new");
    await page.locator('input[name="thesisCorrect"][value="no"]').check({ force: true });
    await page.locator('input[name="followedProcess"][value="yes"]').check({ force: true });
    await page.locator('input[name="drivenBy"][value="skill"]').check({ force: true });
    await page.fill('[name="thesisNote"]', "The margin claim was simply wrong.");
    await page.fill('[name="lesson"]', "A margin assumption needs a named mechanism, not a trend.");
    await page.fill('[name="processChange"]', "No position sized above 3% on a margin-recovery claim.");
    await Promise.all([page.waitForURL(/\/postmortems\/pm_/), page.click("[data-primary-submit]")]);
    const b = await page.innerText("body");
    has(b, "Right about how to be wrong", "postmortem headline");
    has(b, "A margin assumption needs a named mechanism", "postmortem lesson");
  });

  await step("patterns page absorbs the new records", async () => {
    const b = await visit(page, "/patterns", "22-patterns-after");
    has(b, "Calibration", "patterns");
  });

  await step("a real security is created with real price history", async () => {
    await visit(page, "/positions/new?q=freeport");
    await page.click('a[href*="ticker=FCX"]');
    await page.fill('[name="summary"]', "Smoke test: grid copper demand is price-insensitive.");
    await page.fill('[name="shares"]', "10");
    await page.fill('[name="price"]', "50");
    await page.fill('[name="assumptions_new"]', "No new supply reaches market before 2028.");
    await Promise.all([page.waitForURL(/\/positions\/pos_/), page.click("[data-primary-submit]")]);
    const b = await page.innerText("body");
    has(b, "FCX", "real position");
    has(b, "Price path", "a backfill should give it a price path");
  });

  await browser.close();

  console.log(`\n${passed} steps passed, ${failures.length} failed.`);
  if (SHOTS) console.log(`screenshots in ${SHOTS}`);
  if (failures.length) {
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
}

main();
