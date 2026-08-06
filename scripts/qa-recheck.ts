/**
 * Re-checks the specific defects reported in the frontend QA pass, so none of
 * them can come back quietly. Needs `npm run dev` on :3000.
 *
 *   npx tsx scripts/qa-recheck.ts
 *
 * Writes to the live database; run `npm run seed -- --force` afterwards.
 */
import { chromium, type Page } from "playwright";

const BASE = process.env.ASOF_URL ?? "http://localhost:3000";
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

const text = (p: Page) => p.innerText("body");
const has = (body: string, needle: string, where: string) => {
  if (!body.toLowerCase().includes(needle.toLowerCase()))
    throw new Error(`${where} is missing "${needle}"`);
};
const hasNot = (body: string, needle: string, where: string) => {
  if (body.toLowerCase().includes(needle.toLowerCase()))
    throw new Error(`${where} still contains "${needle}"`);
};

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

  console.log("errors are returned, not thrown");

  await step("selling more than you hold reports itself and keeps your writing", async () => {
    await page.goto(`${BASE}/decisions/new?position=pos_dlr`, { waitUntil: "networkidle" });
    const why = "QA: this reasoning must survive a rejected save.";
    await page.locator('input[name="type"][value="reduce"]').check({ force: true });
    await page.fill('[name="what"]', "Sell 9999 shares.");
    await page.fill('[name="why"]', why);
    await page.fill('[name="shares"]', "9999");
    await page.fill('[name="price"]', "170");
    await page.click("[data-primary-submit]");
    await page.waitForSelector("[data-form-error]", { timeout: 20_000 });
    const body = await text(page);
    has(body, "Not saved", "error banner");
    has(body, "you held", "error message");
    hasNot(body, "unhandled", "error banner");
    // The whole point: the user's work is still on the page.
    const kept = await page.inputValue('[name="why"]');
    if (kept !== why) throw new Error(`the reasoning was lost (got "${kept}")`);
  });

  await step("scenario probabilities that do not sum to 100 report themselves", async () => {
    await page.goto(`${BASE}/events/new`, { waitUntil: "networkidle" });
    await page.fill('[name="title"]', "QA probability check");
    await page.fill('[name="prob_Bull"]', "50");
    await page.fill('[name="prob_Base"]', "50");
    await page.fill('[name="prob_Bear"]', "50");
    await page.click("[data-primary-submit]");
    await page.waitForSelector("[data-form-error]", { timeout: 20_000 });
    const body = await text(page);
    has(body, "must sum to 100", "error message");
    has(body, "150", "error message should quote the actual total");
    if ((await page.inputValue('[name="title"]')) !== "QA probability check")
      throw new Error("the title was lost");
  });

  await step("a duplicate ticker is refused with a useful reason", async () => {
    await page.goto(`${BASE}/positions/new`, { waitUntil: "networkidle" });
    await page.fill('[name="ticker"]', "CEG");
    await page.fill('[name="name"]', "Constellation Energy");
    await page.fill('[name="summary"]', "QA: duplicate instrument guard.");
    await page.click("[data-primary-submit]");
    await page.waitForSelector("[data-form-error]", { timeout: 20_000 });
    has(await text(page), "already in the book", "duplicate error");
  });

  await step("a future-dated record is refused", async () => {
    const soon = new Date(Date.now() + 5 * 86_400_000);
    const iso = `${soon.getFullYear()}-${String(soon.getMonth() + 1).padStart(2, "0")}-${String(soon.getDate()).padStart(2, "0")}`;
    await page.goto(`${BASE}/decisions/new?position=pos_dlr`, { waitUntil: "networkidle" });
    await page.fill('[name="what"]', "QA future date.");
    await page.fill('[name="why"]', "QA.");
    await page.fill('[name="occurredAt"]', iso);
    await page.click("[data-primary-submit]");
    await page.waitForSelector("[data-form-error]", { timeout: 20_000 });
    has(await text(page), "in the future", "future-date error");
  });

  console.log("\ndates");

  await step("date pickers default to today in local time, not tomorrow", async () => {
    const now = new Date();
    const localToday = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    for (const url of ["/decisions/new", "/positions/new", "/positions/pos_nke/evidence"]) {
      await page.goto(`${BASE}${url}`, { waitUntil: "networkidle" });
      const v = await page.inputValue('[name="occurredAt"]');
      if (v !== localToday) throw new Error(`${url} defaulted to ${v}, local today is ${localToday}`);
    }
  });

  await step("a record dated today reads as today, not yesterday", async () => {
    await page.goto(`${BASE}/decisions/new?position=pos_dlr`, { waitUntil: "networkidle" });
    await page.fill('[name="what"]', "QA same-day wording check.");
    await page.fill('[name="why"]', "Recorded today; must not read as yesterday.");
    await Promise.all([
      page.waitForURL(/\/decisions\/dec_/, { timeout: 20_000 }),
      page.click("[data-primary-submit]"),
    ]);
    // Only the decision's own date line matters; other records on the page may
    // legitimately be from yesterday.
    const eyebrow = (await page.innerText("header")) ?? "";
    has(eyebrow, "today", `the decision's own date line should say today (got "${eyebrow}")`);
    hasNot(eyebrow, "yesterday", "the decision's own date line must not say yesterday");
  });

  console.log("\nreplay");

  await step("the sealed header prices the position at the mark it shows", async () => {
    for (const id of ["dec_nvda_add", "dec_nvda_trim"]) {
      await page.goto(`${BASE}/replay/${id}`, { waitUntil: "networkidle" });
      const body = await text(page);
      const shares = Number(/([\d,]+)\s*sh/.exec(body)?.[1]?.replace(/,/g, "") ?? "0");
      const value = Number(
        /\$([\d,]+)\s*·/.exec(body)?.[1]?.replace(/,/g, "") ??
          /\$([\d,]+)/.exec(body)?.[1]?.replace(/,/g, "") ??
          "0"
      );
      const mark = Number(/Mark that day\s*\$?([\d,.]+)/i.exec(body)?.[1]?.replace(/,/g, "") ?? "0");
      if (!shares || !mark) throw new Error(`${id}: could not read shares/mark from the page`);
      const implied = shares * mark;
      if (Math.abs(implied - value) / implied > 0.01) {
        throw new Error(`${id}: ${shares} sh x $${mark} = ${implied}, but the header shows ${value}`);
      }
    }
  });

  await step("the sealed room does not name the decision in a catalyst title", async () => {
    const body = await text(page.constructor ? page : page);
    await page.goto(`${BASE}/replay/dec_nvda_add`, { waitUntil: "networkidle" });
    hasNot(await text(page), "the add was sized ahead of this", "sealed room");
    void body;
  });

  await step("the reveal does not call a judged decision unrecorded", async () => {
    await page.goto(`${BASE}/replay/dec_nke_add?reveal=rp_seed_1`, { waitUntil: "networkidle" });
    has(await text(page), "what you decided then", "reveal");
    // Scoped to the "then" panel — other decisions further down the page may
    // genuinely have no outcome recorded yet.
    const thenPanel = await page.evaluate(() => {
      const labels = [...document.querySelectorAll("div")].filter((d) =>
        /what you decided then/i.test(d.textContent ?? "")
      );
      const closest = labels[labels.length - 1]?.parentElement;
      return (closest as HTMLElement | null)?.innerText ?? "";
    });
    if (/outcome not recorded/i.test(thenPanel)) {
      throw new Error(`the sealed panel still says "outcome not recorded": ${thenPanel.slice(0, 160)}`);
    }
  });

  await step("the reveal timeline shows assumption text, not raw ids", async () => {
    const body = await text(page);
    if (/stands against\s*\n?\s*a\d\b/i.test(body)) {
      throw new Error("a raw assumption id is still rendered");
    }
  });

  await step("the replay list is in date order", async () => {
    await page.goto(`${BASE}/replay`, { waitUntil: "networkidle" });
    const dates = await page.$$eval(
      'a[href^="/replay/"] span.num',
      (els) =>
        els
          .map((e) => (e.textContent ?? "").trim())
          .filter((t) => /^[A-Z][a-z]{2} \d{1,2}, \d{4}$/.test(t))
    );
    const tail = dates.slice(3).map((d) => new Date(d).getTime());
    for (let i = 1; i < tail.length; i++) {
      if (tail[i] > tail[i - 1]) throw new Error(`out of order at ${dates[3 + i]}`);
    }
  });

  console.log("\nsignals and polish");

  await step("a fired exit condition is surfaced on Today", async () => {
    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    const body = await text(page);
    has(body, "condition has fired", "attention queue");
    has(body, "CEG", "attention queue");
  });

  await step("the correlation matrix shows numbers, not only colour", async () => {
    await page.goto(`${BASE}/beliefs`, { waitUntil: "networkidle" });
    const body = await text(page);
    has(body, "Realised correlation", "beliefs");
    if (!/-?0\.\d{2}/.test(body)) throw new Error("no correlation coefficients rendered as text");
  });

  await step("a bad url gets the app's own 404, not a bare panel", async () => {
    const res = await page.goto(`${BASE}/positions/pos_nope`, { waitUntil: "networkidle" });
    if (res?.status() !== 404) throw new Error(`expected 404, got ${res?.status()}`);
    const body = await text(page);
    has(body, "There is no record at that address", "404 page");
    has(body, "Today", "404 page should offer a way back");
  });

  await step("a monitor that has fired says so, and lands on the timeline", async () => {
    await page.goto(`${BASE}/positions/pos_nke`, { waitUntil: "networkidle" });
    const body = await text(page);
    has(body, "Watching", "position page");
    has(body, "Condition met", "the fired monitor");
    has(body, "Speaks for", "the assumption the monitor speaks for");
    has(body, "Monitor · NKE", "the firing should appear on the timeline as evidence");
  });

  await step("a monitor can be created through the form", async () => {
    await page.goto(`${BASE}/positions/pos_dlr/monitor`, { waitUntil: "networkidle" });
    await page.fill('[name="label"]', "QA: yield above 4%");
    await page.locator('input[name="kind"][value="series_level"]').check({ force: true });
    await page.fill('[name="symbol"]', "^TNX");
    await page.fill('[name="threshold"]', "4");
    await page.locator('input[name="comparator"][value="above"]').check({ force: true });
    await page.fill('[name="meaning"]', "QA: the rate leg stops being incidental.");
    await Promise.all([
      page.waitForURL(/\/positions\/pos_dlr$/, { timeout: 20_000 }),
      page.click("[data-primary-submit]"),
    ]);
    const body = await text(page);
    has(body, "QA: yield above 4%", "the new monitor");
    // 10-year is above 4%, so it should already read as met.
    has(body, "Condition met", "a condition already true should say so immediately");
  });

  await step("a monitor on an unknown symbol is refused with a reason", async () => {
    await page.goto(`${BASE}/positions/pos_dlr/monitor`, { waitUntil: "networkidle" });
    await page.fill('[name="label"]', "QA: nonsense symbol");
    await page.fill('[name="symbol"]', "ZZZNOTREAL");
    await page.fill('[name="threshold"]', "1");
    await page.click("[data-primary-submit]");
    await page.waitForSelector("[data-form-error]", { timeout: 20_000 });
    has(await text(page), "No price history cached", "unknown-symbol error");
  });

  await step("a passed catalyst is not offered as upcoming", async () => {
    await page.goto(`${BASE}/decisions/new`, { waitUntil: "networkidle" });
    const opts = await page.$$eval('select[name="linkedEventId"] option', (els) =>
      els.map((e) => (e.textContent ?? "").trim())
    );
    if (opts.some((o) => /China grid capex/i.test(o))) {
      throw new Error("an event whose date has passed is still listed as upcoming");
    }
  });

  await browser.close();
  console.log(`\n${passed} checks passed${failures.length ? `, ${failures.length} failed` : ""}.`);
  if (failures.length) {
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
}

main();
