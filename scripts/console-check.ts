/**
 * Loads every page in a real browser and fails on any console error or warning.
 * No screenshots — Playwright's caret handling mutates inputs and produces a
 * false hydration mismatch.
 *
 *   npx tsx scripts/console-check.ts
 */
import { chromium } from "playwright";

const BASE = process.env.ASOF_URL ?? "http://localhost:3000";

const ROUTES = [
  "/",
  "/positions",
  "/positions/new",
  "/positions/pos_nvda",
  "/positions/pos_nke",
  "/positions/pos_pypl",
  "/positions/pos_smci",
  "/positions/pos_nvda/thesis",
  "/positions/pos_nke/evidence",
  "/positions/pos_pypl/postmortem",
  "/decisions",
  "/decisions/new",
  "/decisions/dec_nvda_add",
  "/decisions/dec_nke_hold",
  "/events",
  "/events/new",
  "/events/ev_nvda_q3",
  "/events/ev_nke_q4",
  "/events/ev_ceg_pjm",
  "/events/ev_fcx_china",
  "/beliefs",
  "/beliefs/bl_aicapex",
  "/beliefs/bl_rates",
  "/replay",
  "/replay/dec_nvda_add",
  "/replay/dec_smci_pass",
  "/replay/dec_pypl_exit",
  "/replay/dec_nke_add?reveal=rp_seed_1",
  "/patterns",
  "/postmortems/pm_pypl",
  "/scorecard",
  "/signals",
  "/signals?source=monitor&symbol=NKE",
];

async function main() {
  const browser = await chromium.launch();
  const problems: string[] = [];

  for (const route of ROUTES) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const found: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error" || m.type() === "warning") found.push(`[${m.type()}] ${m.text()}`);
    });
    page.on("pageerror", (e) => found.push(`[pageerror] ${e.message}`));

    const res = await page.goto(`${BASE}${route}`, { waitUntil: "networkidle" });
    if (res?.status() !== 200) found.push(`[http] status ${res?.status()}`);

    if (found.length) {
      console.log(`  FAIL  ${route}`);
      for (const f of found) {
        console.log(`        ${f.slice(0, 200)}`);
        problems.push(`${route} — ${f.slice(0, 160)}`);
      }
    } else {
      console.log(`  ok    ${route}`);
    }
    await page.close();
  }

  await browser.close();
  console.log(
    problems.length
      ? `\n${problems.length} console problem(s) across ${ROUTES.length} routes.`
      : `\nAll ${ROUTES.length} routes load clean — no console errors or warnings.`
  );
  if (problems.length) process.exit(1);
}

main();
