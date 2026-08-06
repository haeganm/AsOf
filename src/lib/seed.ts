import type DatabaseType from "better-sqlite3";
import { resetDb } from "./db";

/**
 * The demo book. Dates are relative to seed time so the story never goes stale.
 *
 * The narrative spine: four superficially unrelated holdings (a chip designer, a
 * nuclear utility, a copper miner, a data-center REIT) turn out to be one bet on
 * data-center capex. A fifth (NKE) has evidence sitting against an unreviewed
 * assumption, and was cut to half weight two quarters after its own falsifier
 * fired. One position (PYPL) is closed with an honest postmortem: the process
 * held, the outcome did not. One idea (SMCI) was passed on — a decision that
 * looked wrong for eleven weeks and then looked right.
 */

const DAY = 86_400_000;

export function seedDatabase(db: DatabaseType.Database) {
  const base = Date.now();
  /** daysAgo: positive = past, negative = future */
  const d = (daysAgo: number) => new Date(base - daysAgo * DAY).toISOString();
  const now = new Date(base).toISOString();

  resetDb(db);

  const ins = (table: string, row: Record<string, unknown>) => {
    const cols = Object.keys(row);
    db.prepare(
      `insert into ${table} (${cols.join(",")}) values (${cols.map((c) => "@" + c).join(",")})`
    ).run(row);
  };
  const J = (v: unknown) => JSON.stringify(v);

  const PF = "pf_meridian";
  ins("portfolios", {
    id: PF,
    name: "Meridian — Personal Book",
    description:
      "Concentrated long-only equity book, 5–8 names, 12–36 month holding intent. Sample data.",
    createdAt: d(540),
  });

  // ── Beliefs (risk drivers) ───────────────────────────────────────────────
  const beliefs: Array<[string, string, string, string, number]> = [
    [
      "bl_aicapex",
      "Data-center capital expenditure",
      "The pace of hyperscaler and neocloud spending on compute, power, and physical shell.",
      "Spending stays above consensus through 2027 because capacity, not demand, is the binding constraint. This is the single largest driver in the book and I hold it with less certainty than my position sizing implies.",
      4,
    ],
    [
      "bl_rates",
      "Long-end interest rates",
      "The path of 10y+ yields and the cost of capital for asset-heavy businesses.",
      "Long rates settle higher than the market's terminal assumption. I do not have an edge here — I only need to not be run over by it.",
      2,
    ],
    [
      "bl_china",
      "Chinese industrial demand",
      "Construction, grid, and manufacturing demand out of China, and the credibility of stimulus.",
      "Recovery is real but slower and less commodity-intensive than prior cycles. Grid spend is the exception.",
      3,
    ],
    [
      "bl_consumer",
      "US discretionary consumer strength",
      "Willingness of the middle-income US consumer to pay full price.",
      "Spending holds up in aggregate but trades down by brand. Premium pricing power is narrowing to fewer winners than the market assumes.",
      3,
    ],
    [
      "bl_reg",
      "Utility regulatory accommodation",
      "Whether regulators and grid operators let load growth be priced through to generators.",
      "Regulators will accommodate large-load interconnection because the political cost of refusing it now exceeds the cost of higher bills. Slow, but directionally reliable.",
      4,
    ],
    [
      "bl_packaging",
      "Advanced packaging supply",
      "CoWoS / HBM capacity as the actual ceiling on accelerator shipments.",
      "Packaging and memory stay the constraint through at least mid-2027, which protects pricing for whoever holds the allocation.",
      3,
    ],
  ];
  for (const [id, name, description, stance, confidence] of beliefs) {
    ins("beliefs", { id, name, description, stance, confidence, createdAt: d(540) });
  }

  // ── Positions ────────────────────────────────────────────────────────────
  const positions: Array<Record<string, unknown>> = [
    {
      id: "pos_nvda",
      ticker: "NVDA",
      name: "NVIDIA Corporation",
      assetClass: "Equity — Semiconductors",
      status: "open",
      openedAt: d(520),
      closedAt: null,
    },
    {
      id: "pos_ceg",
      ticker: "CEG",
      name: "Constellation Energy",
      assetClass: "Equity — Independent Power",
      status: "open",
      openedAt: d(400),
      closedAt: null,
    },
    {
      id: "pos_fcx",
      ticker: "FCX",
      name: "Freeport-McMoRan",
      assetClass: "Equity — Copper",
      status: "open",
      openedAt: d(330),
      closedAt: null,
    },
    {
      id: "pos_dlr",
      ticker: "DLR",
      name: "Digital Realty Trust",
      assetClass: "Equity — Data Center REIT",
      status: "open",
      openedAt: d(250),
      closedAt: null,
    },
    {
      id: "pos_nke",
      ticker: "NKE",
      name: "NIKE, Inc.",
      assetClass: "Equity — Consumer Discretionary",
      status: "open",
      openedAt: d(210),
      closedAt: null,
    },
    {
      id: "pos_pypl",
      ticker: "PYPL",
      name: "PayPal Holdings",
      assetClass: "Equity — Payments",
      status: "closed",
      openedAt: d(480),
      closedAt: d(240),
    },
    {
      id: "pos_smci",
      ticker: "SMCI",
      name: "Super Micro Computer",
      assetClass: "Equity — IT Hardware",
      status: "passed",
      openedAt: null,
      closedAt: null,
    },
  ];
  for (const p of positions) {
    // demo=1 keeps price ingestion away from the fictional price paths.
    ins("positions", { ...p, portfolioId: PF, createdAt: p.openedAt ?? d(262), demo: 1 });
  }

  // ── Price marks (illustrative, not real quotes) ───────────────────────────
  const markPaths: Record<string, Array<[number, number]>> = {
    pos_nvda: [
      [520, 62.0], [470, 67.8], [420, 73.9], [360, 81.6], [300, 91.5], [250, 104.2],
      [200, 98.7], [150, 120.9], [100, 132.8], [60, 141.4], [30, 152.1], [4, 147.6],
    ],
    pos_ceg: [
      [400, 178.0], [350, 195.6], [300, 212.8], [250, 241.9], [200, 228.5],
      [150, 257.7], [100, 276.9], [60, 291.2], [30, 305.4], [4, 297.8],
    ],
    pos_fcx: [
      [330, 44.2], [280, 47.1], [230, 43.6], [180, 41.9], [130, 45.3],
      [90, 48.8], [60, 46.4], [30, 49.1], [4, 50.3],
    ],
    pos_dlr: [
      [250, 141.0], [200, 148.6], [150, 155.9], [100, 162.7], [60, 157.8],
      [30, 166.5], [4, 170.9],
    ],
    pos_nke: [
      [210, 82.4], [180, 78.9], [150, 74.1], [120, 71.6], [90, 69.3],
      [60, 66.8], [30, 64.2], [4, 62.9],
    ],
    pos_pypl: [
      [480, 61.2], [430, 66.8], [380, 71.4], [330, 64.9], [280, 58.3], [240, 55.1],
      // after the exit — the reveal has to be allowed to embarrass the decision
      [200, 49.7], [150, 52.4], [100, 61.8], [60, 58.9], [30, 63.5], [4, 65.2],
    ],
    pos_smci: [
      [262, 640.0], [220, 820.0], [180, 930.0], [140, 710.0], [100, 480.0],
      [60, 395.0], [30, 430.0], [4, 412.0],
    ],
  };
  for (const [positionId, path] of Object.entries(markPaths)) {
    path.forEach(([daysAgo, price], i) =>
      ins("marks", { id: `mk_${positionId}_${i}`, positionId, occurredAt: d(daysAgo), price })
    );
  }

  // ── Lots (position size over time) ───────────────────────────────────────
  const lots: Array<[string, number, number, number, string]> = [
    ["pos_nvda", 520, 400, 62.0, "First position in the book."],
    ["pos_nvda", 300, 180, 91.5, "Added into the packaging-constraint thesis ahead of Q2."],
    ["pos_nvda", 120, -120, 128.0, "Trimmed once the position passed the 30% ceiling I had written down."],
    ["pos_ceg", 400, 90, 178.0, "Starter position."],
    ["pos_ceg", 145, 40, 258.0, "Added after the PJM auction confirmed load-growth pass-through."],
    ["pos_fcx", 330, 600, 44.2, "Full size at once — grid copper, not China beta."],
    ["pos_dlr", 250, 180, 141.0, "Physical-shell expression of the same capex bet."],
    ["pos_nke", 210, 300, 82.4, "Turnaround starter."],
    ["pos_nke", 120, 120, 71.6, "Averaged down. Flagging this as a decision to examine later."],
    ["pos_nke", 10, -210, 63.5, "Cut to a half position — the falsifier had fired two quarters earlier."],
    ["pos_pypl", 480, 700, 61.2, "Branded-checkout durability bet."],
    ["pos_pypl", 240, -700, 55.1, "Closed — falsifier hit."],
  ];
  lots.forEach(([positionId, daysAgo, deltaShares, price, note], i) =>
    ins("lots", { id: `lot_${i}`, positionId, occurredAt: d(daysAgo), deltaShares, price, note })
  );

  // A fill is itself a price observation. `recordDecision` writes one for every
  // lot, so the seed must too — otherwise Replay's "mark that day" falls back to
  // an earlier mark and disagrees with the fill quoted in the decision.
  lots.forEach(([positionId, daysAgo, , price], i) =>
    db
      .prepare(
        "insert into marks (id,positionId,occurredAt,price) values (?,?,?,?) on conflict(positionId,occurredAt) do update set price=excluded.price"
      )
      .run(`mk_lot_${i}`, positionId, d(daysAgo), price)
  );

  // ── Position ↔ belief links ──────────────────────────────────────────────
  const links: Array<[string, string, string, string]> = [
    ["pos_nvda", "bl_aicapex", "Direct: revenue is a near-linear function of accelerator capex budgets.", "high"],
    ["pos_nvda", "bl_packaging", "Packaging scarcity is what keeps pricing and share intact against merchant silicon.", "high"],
    ["pos_ceg", "bl_aicapex", "Data-center load growth is the demand side of the power-price thesis.", "high"],
    ["pos_ceg", "bl_reg", "The thesis only monetises if regulators let large-load pricing through.", "high"],
    ["pos_ceg", "bl_rates", "A capital-intensive generator is discounted like a bond whether or not I hold a rate view.", "medium"],
    ["pos_fcx", "bl_aicapex", "Grid and transformer copper intensity is the incremental demand I am paid for.", "medium"],
    ["pos_fcx", "bl_china", "China is the swing factor on the base copper price I did not underwrite.", "high"],
    ["pos_dlr", "bl_aicapex", "Leasing spreads are a direct read on shell demand.", "high"],
    ["pos_dlr", "bl_rates", "A REIT balance sheet makes this a levered short on long rates whether I want it or not.", "high"],
    ["pos_nke", "bl_consumer", "The whole thesis is full-price sell-through to a trading-down consumer.", "high"],
    ["pos_nke", "bl_china", "Greater China is a third of the recovery the market is underwriting.", "medium"],
    ["pos_pypl", "bl_consumer", "Branded checkout volume tracks discretionary spend.", "medium"],
    ["pos_smci", "bl_aicapex", "Would have been a third expression of the same capex bet — part of why I passed.", "high"],
  ];
  // Dated to when the position was opened, so a Replay room sealed to an earlier
  // date does not show a connection the investor had not drawn yet.
  // Mirrors the createdAt fallback used when the positions were inserted.
  const openedOn = new Map(
    positions.map((p) => [p.id as string, (p.openedAt as string | null) ?? d(262)])
  );
  links.forEach(([positionId, beliefId, relationship, sensitivity], i) =>
    ins("position_beliefs", {
      id: `pb_${i}`,
      positionId,
      beliefId,
      relationship,
      sensitivity,
      occurredAt: openedOn.get(positionId) ?? d(540),
      createdAt: openedOn.get(positionId) ?? d(540),
    })
  );

  // ── Theses (append-only versions) ────────────────────────────────────────
  type ThesisSeed = Record<string, unknown>;
  const theses: ThesisSeed[] = [
    {
      id: "th_nvda_1",
      positionId: "pos_nvda",
      versionNo: 1,
      occurredAt: d(520),
      summary:
        "Accelerated computing is a platform shift, and the constraint on it is supply, not demand — which means margins hold far longer than a normal semi cycle.",
      marketView:
        "The market is treating this as a cyclical semiconductor upturn with a 2025 digestion year, and is anchoring on gross margin mean-reversion toward the low 60s.",
      variantView:
        "I think the binding constraint is advanced packaging and memory, not customer appetite. If supply is the ceiling, pricing does not break when competitors announce — it breaks when packaging capacity catches up, which is years out. The market is modelling a cycle; I am underwriting an allocation regime.",
      assumptions: J([
        { id: "a1", text: "Hyperscaler capex budgets grow, not merely re-mix, through FY27.", status: "intact" },
        { id: "a2", text: "CoWoS/HBM capacity remains the binding constraint on units shipped.", status: "intact" },
        { id: "a3", text: "Software lock-in keeps internal silicon at complementary rather than substitutive share.", status: "intact" },
        { id: "a4", text: "Gross margin holds above 70% — no forced price defence.", status: "intact" },
      ]),
      catalysts: J([
        "Quarterly results and next-quarter guide (the capex read-through)",
        "Packaging capacity announcements from the foundry",
        "Hyperscaler capex guidance at their own Q4 prints",
      ]),
      risks: J([
        "Customer concentration — five buyers are most of the revenue",
        "A digestion pause misread as a cycle top would take the multiple down hard",
        "Export controls narrowing the addressable market further",
      ]),
      falsifiers: J([
        "Two consecutive quarters of gross margin compression that management attributes to pricing rather than mix",
        "A hyperscaler explicitly guiding accelerator capex down year-on-year",
        "Packaging capacity additions that visibly exceed order growth",
      ]),
      horizon: "24–36 months",
      addCondition:
        "A drawdown of 25%+ driven by sentiment while packaging remains sold out and no falsifier has fired.",
      trimCondition:
        "Position exceeds 30% of the book, or the multiple re-rates beyond what the supply story alone can carry.",
      exitCondition:
        "Any falsifier fires, or I can no longer explain why the constraint has not moved.",
      confidence: 4,
      changeNote: null,
    },
    {
      id: "th_nvda_2",
      positionId: "pos_nvda",
      versionNo: 2,
      occurredAt: d(295),
      summary:
        "Supply-constrained platform shift, now with the constraint confirmed and the customer list broadening beyond the original five.",
      marketView:
        "Consensus has moved to accepting the demand but has replaced the cycle worry with a concentration worry.",
      variantView:
        "The Q2 print did the thing I was waiting for: management framed the limit as packaging, on the record, and the customer mix widened to sovereign and neocloud buyers. That reduces the concentration risk the market has just discovered. I am more confident than I was, and I want to be honest that some of that confidence is coming from the price working.",
      assumptions: J([
        { id: "a1", text: "Hyperscaler capex budgets grow, not merely re-mix, through FY27.", status: "intact" },
        { id: "a2", text: "CoWoS/HBM capacity remains the binding constraint on units shipped.", status: "intact" },
        { id: "a3", text: "Software lock-in keeps internal silicon at complementary rather than substitutive share.", status: "intact" },
        { id: "a4", text: "Gross margin holds above 70% — no forced price defence.", status: "intact" },
        { id: "a5", text: "Neocloud and sovereign demand is incremental, not the same dollars re-routed.", status: "intact" },
      ]),
      catalysts: J([
        "Quarterly results and next-quarter guide",
        "Packaging capacity announcements from the foundry",
        "Neocloud financing conditions — these buyers are credit-sensitive",
      ]),
      risks: J([
        "Neocloud demand is financed demand, and financing is not a durable customer",
        "Concentration is improving but still extreme",
        "A digestion pause misread as a cycle top",
      ]),
      falsifiers: J([
        "Two consecutive quarters of pricing-driven gross margin compression",
        "A hyperscaler guiding accelerator capex down year-on-year",
        "Packaging additions visibly exceeding order growth",
        "Neocloud order cancellations tied to funding rather than demand",
      ]),
      horizon: "24–36 months",
      addCondition: "25%+ sentiment drawdown with packaging still sold out and no falsifier fired.",
      trimCondition: "Above 30% of book, or multiple beyond what supply scarcity alone supports.",
      exitCondition: "Any falsifier fires.",
      confidence: 5,
      changeNote:
        "Updated after Q2: the packaging constraint was confirmed on the call and the buyer base widened. Added assumption a5 on neocloud demand being incremental — this is now load-bearing and I did not need it before.",
    },
    {
      id: "th_nvda_3",
      positionId: "pos_nvda",
      versionNo: 3,
      occurredAt: d(95),
      summary:
        "Still a supply-constrained platform shift, but the thesis now leans on financed demand holding up, which is a weaker foundation than the one I started with.",
      marketView:
        "The market has fully accepted the demand story and is arguing about the multiple.",
      variantView:
        "My variant view has quietly thinned. When the market agreed with me, my edge became the durability of neocloud financing rather than anything about the technology. That is a credit call dressed as a technology call, and it is not what I am good at. I am holding, at a smaller weight than my confidence would suggest, precisely because the reason to own it has drifted.",
      assumptions: J([
        { id: "a1", text: "Hyperscaler capex budgets grow, not merely re-mix, through FY27.", status: "intact" },
        { id: "a2", text: "CoWoS/HBM capacity remains the binding constraint on units shipped.", status: "weakening" },
        { id: "a3", text: "Software lock-in keeps internal silicon at complementary rather than substitutive share.", status: "weakening" },
        { id: "a4", text: "Gross margin holds above 70% — no forced price defence.", status: "intact" },
        { id: "a5", text: "Neocloud and sovereign demand is incremental, not the same dollars re-routed.", status: "intact" },
      ]),
      catalysts: J([
        "Q3 results and the FY27 capex commentary",
        "Foundry packaging capacity guidance",
        "Any hyperscaler shifting an internal-silicon programme from complementary to primary",
      ]),
      risks: J([
        "The thesis is now a financing-conditions call I am not equipped to make",
        "Packaging relief arriving faster than expected — capacity additions are now visible",
        "Internal silicon moving from complementary to substitutive at one large buyer",
      ]),
      falsifiers: J([
        "Two consecutive quarters of pricing-driven gross margin compression",
        "A hyperscaler guiding accelerator capex down year-on-year",
        "Packaging additions visibly exceeding order growth",
        "Neocloud order cancellations tied to funding rather than demand",
        "A top-five customer moving a flagship workload to internal silicon",
      ]),
      horizon: "12–24 months — shortened from 24–36",
      addCondition:
        "I do not currently have an add condition. Given the thesis has drifted toward a credit call, adding would be sizing into an edge I cannot defend.",
      trimCondition:
        "Above 30% of book, or a second assumption moving to broken.",
      exitCondition: "Any falsifier fires, or a2 and a3 are both broken.",
      confidence: 4,
      changeNote:
        "Downgraded a2 and a3 to weakening: packaging capacity additions are now visible and one large buyer has moved a production workload to internal silicon. Shortened horizon. Removed the add condition — the honest answer is that I no longer have one.",
    },

    {
      id: "th_ceg_1",
      positionId: "pos_ceg",
      versionNo: 1,
      occurredAt: d(400),
      summary:
        "The cleanest way to own data-center demand growth is to own the scarce firm power it needs, because generation cannot be built on a two-year timeline and compute can.",
      marketView:
        "The market values this as a regulated-adjacent utility on a mid-teens multiple with modest load growth.",
      variantView:
        "Existing nuclear baseload is the only asset class that can serve a 24/7 large load starting tomorrow. That scarcity should be priced as an option on load growth, not as a utility. The market is applying a utility multiple to what is functionally a scarce-asset toll road.",
      assumptions: J([
        { id: "a1", text: "Large-load interconnection requests keep growing faster than firm generation can be added.", status: "intact" },
        { id: "a2", text: "Regulators and the grid operator allow load-growth economics to reach the generator.", status: "intact" },
        { id: "a3", text: "Nuclear PTC floor limits the downside on power prices.", status: "intact" },
        { id: "a4", text: "No forced socialisation of large-load costs onto generators.", status: "intact" },
      ]),
      catalysts: J([
        "PJM capacity auction clearing prices",
        "Direct-to-data-center power purchase agreements",
        "State-level large-load tariff rulings",
      ]),
      risks: J([
        "Regulatory backlash if retail bills rise visibly",
        "A behind-the-meter ruling going the wrong way",
        "Power prices are still a commodity and I am long one",
      ]),
      falsifiers: J([
        "A capacity auction clearing materially below the prior year despite rising load",
        "A regulator blocking or clawing back large-load pricing",
        "A signed PPA at a price that implies no scarcity premium",
      ]),
      horizon: "24–36 months",
      addCondition: "A regulatory scare that knocks 20%+ off without changing the interconnection queue.",
      trimCondition: "The scarcity premium is fully priced — above ~22x forward, or the queue stops growing.",
      exitCondition: "A falsifier fires, particularly a clawback ruling.",
      confidence: 3,
      changeNote: null,
    },
    {
      id: "th_ceg_2",
      positionId: "pos_ceg",
      versionNo: 2,
      occurredAt: d(145),
      summary:
        "Scarce firm power as a levered option on data-center load growth — now with the pass-through mechanism confirmed by an auction print.",
      marketView:
        "Consensus has re-rated the sector and now debates how much of the auction result is repeatable.",
      variantView:
        "The auction did more than beat: it established that the grid operator will price scarcity rather than administratively suppress it. That is the mechanism assumption (a2), and it is the one I was least sure of. It is now the most confirmed part of the thesis. The remaining question is political durability, not market design.",
      assumptions: J([
        { id: "a1", text: "Large-load interconnection requests keep growing faster than firm generation can be added.", status: "intact" },
        { id: "a2", text: "Regulators and the grid operator allow load-growth economics to reach the generator.", status: "intact" },
        { id: "a3", text: "Nuclear PTC floor limits the downside on power prices.", status: "intact" },
        { id: "a4", text: "No forced socialisation of large-load costs onto generators.", status: "weakening" },
        { id: "a5", text: "Political tolerance for higher retail bills survives one election cycle.", status: "intact" },
      ]),
      catalysts: J([
        "Next capacity auction",
        "State legislative sessions on large-load tariffs",
        "Additional direct PPAs",
      ]),
      risks: J([
        "Retail bill increases are now a live political story",
        "Consumer advocate intervention in large-load dockets",
        "The re-rating has removed the valuation cushion",
      ]),
      falsifiers: J([
        "An auction clearing materially lower despite rising load",
        "A regulator clawing back large-load pricing",
        "Legislation socialising large-load costs onto generators",
      ]),
      horizon: "24–36 months",
      addCondition: "A political scare of 20%+ with the interconnection queue still growing.",
      trimCondition: "Above ~22x forward, or the queue flattens.",
      exitCondition: "A clawback ruling, or a4 moving to broken.",
      confidence: 4,
      changeNote:
        "Auction result confirmed a2 outright. Downgraded a4 to weakening — the same result that proved my mechanism also created the political pressure that could reverse it. Added a5 to make the political dependency explicit rather than implicit.",
    },

    {
      id: "th_ceg_3",
      positionId: "pos_ceg",
      versionNo: 3,
      occurredAt: d(35),
      summary:
        "Scarce firm power as a levered option on data-center load growth — with the political leg now broken rather than merely weakening.",
      marketView:
        "The market is treating the socialisation filings as noise and continuing to price the auction result as repeatable.",
      variantView:
        "I no longer think a4 survives. A second state has taken up the consumer-advocate filing and the language has moved from allocation to recovery of costs already incurred. My exit condition names exactly this, and I am recording that it has fired before I decide what to do — writing it down first is the only way I get to find out whether I follow my own rules.",
      assumptions: J([
        { id: "a1", text: "Large-load interconnection requests keep growing faster than firm generation can be added.", status: "intact" },
        { id: "a2", text: "Regulators and the grid operator allow load-growth economics to reach the generator.", status: "intact" },
        { id: "a3", text: "Nuclear PTC floor limits the downside on power prices.", status: "intact" },
        { id: "a4", text: "No forced socialisation of large-load costs onto generators.", status: "broken" },
        { id: "a5", text: "Political tolerance for higher retail bills survives one election cycle.", status: "weakening" },
      ]),
      catalysts: J([
        "Rulings in the two open state dockets",
        "Next capacity auction",
        "Any legislative text that names generators explicitly",
      ]),
      risks: J([
        "The thesis now depends on a4 being reversed on appeal, which is a legal call I cannot make",
        "A re-rating downward as the market catches up to the filings",
        "I am holding a fifth of the book against a broken assumption",
      ]),
      falsifiers: J([
        "An auction clearing materially lower despite rising load",
        "A regulator clawing back large-load pricing",
        "Legislation socialising large-load costs onto generators",
      ]),
      horizon: "Reduced to: until the first docket rules",
      addCondition: "None. Adding against a broken assumption is how a thesis becomes a position.",
      trimCondition: "N/A — the exit condition below is the live one.",
      exitCondition: "A clawback ruling, or a4 moving to broken. a4 is now broken.",
      confidence: 2,
      changeNote:
        "Marked a4 broken. My exit condition names a4 explicitly, so on my own written rule this position should be closed or halved. I have not done it yet, and I want that gap visible rather than quietly resolved by rewriting the condition.",
    },
    {
      id: "th_fcx_1",
      positionId: "pos_fcx",
      versionNo: 1,
      occurredAt: d(330),
      summary:
        "Copper supply cannot respond to grid electrification on any timeline that matters, and the market is still pricing copper off Chinese property rather than off the grid.",
      marketView:
        "Copper is treated as a China property derivative, so the demand narrative is bearish.",
      variantView:
        "The incremental demand is grid, transformers, and data-center electrical infrastructure — not apartment blocks. That demand is price-insensitive and policy-driven. Meanwhile no meaningful new supply arrives before 2028 and existing grades keep falling. I am underwriting the demand mix shift, not a China recovery.",
      assumptions: J([
        { id: "a1", text: "Grid and electrification copper intensity grows fast enough to offset weak Chinese construction.", status: "intact" },
        { id: "a2", text: "No major new supply reaches market before 2028.", status: "intact" },
        { id: "a3", text: "Grasberg and Indonesian operations remain politically stable and permitted.", status: "weakening" },
        { id: "a4", text: "Cost inflation stays below realised price gains.", status: "intact" },
      ]),
      catalysts: J([
        "Chinese grid investment budget announcements",
        "Indonesian smelter and export permit decisions",
        "Quarterly production and unit-cost prints",
      ]),
      risks: J([
        "Indonesian resource nationalism — this is the risk I am least able to handicap",
        "A genuine Chinese hard landing overwhelming the mix shift",
        "It is a miner: operational disappointment is always available",
      ]),
      falsifiers: J([
        "Chinese grid capex guided down year-on-year",
        "An Indonesian export or ownership decision that materially impairs Grasberg economics",
        "Two consecutive quarters of unit costs rising faster than realised price",
      ]),
      horizon: "24–36 months",
      addCondition: "Copper below $4.00/lb on macro fear while grid capex guidance is still rising.",
      trimCondition: "Above $5.50/lb, or a3 moving to broken.",
      exitCondition: "An Indonesian decision that impairs Grasberg, or Chinese grid capex guided down.",
      confidence: 3,
      changeNote: null,
    },

    {
      id: "th_dlr_1",
      positionId: "pos_dlr",
      versionNo: 1,
      occurredAt: d(250),
      summary:
        "Data-center shell is a landlord business at a moment when tenants are desperate and new supply is gated by power, so releasing spreads should surprise to the upside.",
      marketView:
        "Valued as a rate-sensitive REIT with a mid-single-digit growth profile.",
      variantView:
        "Power interconnection has turned an ordinary real estate business into a scarce-permit business. Existing capacity with power already attached should re-lease at spreads REIT models do not contemplate. The market is discounting the rate exposure correctly and the scarcity incorrectly.",
      assumptions: J([
        { id: "a1", text: "Releasing spreads stay positive and double-digit on expiring capacity.", status: "intact" },
        { id: "a2", text: "Power interconnection continues to gate new competing supply.", status: "intact" },
        { id: "a3", text: "Cost of debt does not rise faster than releasing spreads improve.", status: "intact" },
        { id: "a4", text: "Hyperscaler tenants keep signing long-duration leases rather than building owned capacity.", status: "intact" },
      ]),
      catalysts: J([
        "Quarterly leasing and backlog disclosure",
        "Refinancing at disclosed rates",
        "FOMC path and the long end",
      ]),
      risks: J([
        "This is a levered short on long rates whether or not I want that position",
        "Tenants deciding to own rather than lease",
        "Development yields compressing as everyone builds",
      ]),
      falsifiers: J([
        "Releasing spreads turning negative or single-digit",
        "Cost of new debt exceeding development yields",
        "A major tenant publicly shifting to owned capacity",
      ]),
      horizon: "18–30 months",
      addCondition: "A rate-driven drawdown of 20%+ with leasing backlog still growing.",
      trimCondition: "If cost of debt approaches development yields.",
      exitCondition: "Releasing spreads turning single-digit, or a3 breaking.",
      confidence: 4,
      changeNote: null,
    },
    {
      id: "th_dlr_2",
      positionId: "pos_dlr",
      versionNo: 2,
      occurredAt: d(90),
      summary:
        "Scarce powered shell with strong leasing, held despite a rate exposure I am not compensated for having an opinion about.",
      marketView:
        "The market is trading it on rate headlines and largely ignoring the leasing disclosure.",
      variantView:
        "The leasing side of the thesis is working better than I underwrote — spreads have been consistently above my base case. The financing side is working worse. Net, the position is fine and my reason for owning it is intact, but I should stop telling myself the rate exposure is incidental. It is half the outcome.",
      assumptions: J([
        { id: "a1", text: "Releasing spreads stay positive and double-digit on expiring capacity.", status: "intact" },
        { id: "a2", text: "Power interconnection continues to gate new competing supply.", status: "intact" },
        { id: "a3", text: "Cost of debt does not rise faster than releasing spreads improve.", status: "weakening" },
        { id: "a4", text: "Hyperscaler tenants keep signing long-duration leases rather than building owned capacity.", status: "intact" },
      ]),
      catalysts: J([
        "Q3 leasing and 2027 guidance",
        "Next refinancing print",
        "FOMC September decision",
      ]),
      risks: J([
        "Refinancing at rates that eat the leasing upside",
        "Rate exposure is now the dominant variable, not the thesis",
        "Development yield compression across the sector",
      ]),
      falsifiers: J([
        "Releasing spreads turning single-digit",
        "Cost of new debt exceeding development yields",
        "A major tenant publicly shifting to owned capacity",
      ]),
      horizon: "18–30 months",
      addCondition: "20%+ rate-driven drawdown with backlog still growing — but at this point I would rather add to the equity expression of this bet than the levered one.",
      trimCondition: "If cost of debt approaches development yields, or on a rate shock I cannot underwrite.",
      exitCondition: "Releasing spreads single-digit, or a3 breaking.",
      confidence: 3,
      changeNote:
        "Downgraded a3 to weakening after the last refinancing came in above my assumed cost of debt. Lowered confidence 4 → 3 and said the uncomfortable thing out loud: half of this position's outcome is a rate call I have no edge on.",
    },

    {
      id: "th_nke_1",
      positionId: "pos_nke",
      versionNo: 1,
      occurredAt: d(210),
      summary:
        "A brand this strong does not lose pricing power permanently from a distribution mistake, and the fix is within management's control.",
      marketView:
        "The market believes the brand is structurally impaired by competition from newer running brands.",
      variantView:
        "The damage was self-inflicted — pulling out of wholesale and over-indexing to classics starved the pipeline. Self-inflicted damage is repairable in a way that competitive displacement is not. New management is re-entering wholesale and rebuilding the innovation pipeline, and the market is pricing permanent impairment.",
      assumptions: J([
        { id: "a1", text: "Wholesale re-entry restores shelf space without permanent margin give-back.", status: "intact" },
        { id: "a2", text: "Gross margin recovers toward 44%+ as promotional clearance normalises.", status: "intact" },
        { id: "a3", text: "Innovation pipeline delivers a genuine franchise product within 18 months.", status: "intact" },
        { id: "a4", text: "Greater China stabilises rather than structurally declines.", status: "intact" },
      ]),
      catalysts: J([
        "Quarterly results and gross margin trajectory",
        "Wholesale partner commentary",
        "Product launches at the next major sport cycle",
      ]),
      risks: J([
        "Clearance takes longer and costs more margin than guided",
        "Competitive displacement turns out to be real rather than cyclical",
        "China does not stabilise",
      ]),
      falsifiers: J([
        "Gross margin failing to inflect for three consecutive quarters",
        "Wholesale partners reporting declining Nike share of floor space",
        "A second reset of the turnaround timeline by management",
      ]),
      horizon: "18–30 months",
      addCondition: "Below $70 with gross margin inflecting as guided.",
      trimCondition: "On recovery to mid-90s before the margin story is proven.",
      exitCondition: "Any falsifier fires — particularly a second timeline reset.",
      confidence: 4,
      changeNote: null,
    },
    {
      id: "th_nke_2",
      positionId: "pos_nke",
      versionNo: 2,
      occurredAt: d(125),
      summary:
        "Self-inflicted brand damage being repaired by new management — slower than guided, but the mechanism is still intact.",
      marketView:
        "The market has given up on the timeline and is treating each quarter as evidence of structural decline.",
      variantView:
        "The turnaround is behind schedule on clearance but the wholesale re-entry is measurably working — shelf space is coming back. I think the market is confusing a slow fix with no fix. The thing I am watching is whether the margin inflection shows up at all, because that is the part I cannot see from the outside.",
      assumptions: J([
        { id: "a1", text: "Wholesale re-entry restores shelf space without permanent margin give-back.", status: "intact" },
        { id: "a2", text: "Gross margin recovers toward 44%+ as promotional clearance normalises.", status: "weakening" },
        { id: "a3", text: "Innovation pipeline delivers a genuine franchise product within 18 months.", status: "weakening" },
        { id: "a4", text: "Greater China stabilises rather than structurally declines.", status: "weakening" },
      ]),
      catalysts: J([
        "Q4 results and FY guidance — the margin inflection has to be visible here",
        "Holiday sell-through commentary from wholesale partners",
        "Any change in the stated turnaround timeline",
      ]),
      risks: J([
        "Three of four assumptions are now weakening at once",
        "China deterioration is accelerating rather than stabilising",
        "I have already added once; the temptation to average down again is the real risk",
      ]),
      falsifiers: J([
        "Gross margin failing to inflect for three consecutive quarters",
        "Wholesale partners reporting declining share of floor space",
        "A second reset of the turnaround timeline by management",
      ]),
      horizon: "18–30 months, unchanged — which I should probably question",
      addCondition:
        "No further adds. I have used my add and the assumption set has weakened since.",
      trimCondition: "If a2 moves to broken, cut to a half position rather than debating it.",
      exitCondition: "Any falsifier fires.",
      confidence: 3,
      changeNote:
        "Three assumptions downgraded to weakening (a2, a3, a4). Removed the add condition after averaging down once. Kept confidence at 3 rather than lower because the wholesale mechanism is genuinely working — but noting that I am now holding a thesis with one intact leg out of four.",
    },

    {
      id: "th_pypl_1",
      positionId: "pos_pypl",
      versionNo: 1,
      occurredAt: d(480),
      summary:
        "Branded checkout is a habit business trading at a melting-ice-cube multiple, and the habit is stickier than the multiple implies.",
      marketView:
        "The market believes Apple Pay and native checkout are structurally taking branded volume.",
      variantView:
        "Branded checkout share loss is real but slow, and the market is extrapolating it to zero. New management has cost levers and the buyback is retiring a meaningful share count annually. I only need the decline to be gradual for this to work at 11x.",
      assumptions: J([
        { id: "a1", text: "Branded checkout volume growth stays positive, even if low single digit.", status: "intact" },
        { id: "a2", text: "Transaction margin dollars grow, carried by cost discipline.", status: "intact" },
        { id: "a3", text: "Buyback continues at 5%+ of shares annually.", status: "intact" },
        { id: "a4", text: "No large platform makes branded checkout structurally unnecessary.", status: "intact" },
      ]),
      catalysts: J([
        "Quarterly branded checkout volume disclosure",
        "Transaction margin dollar growth",
        "New management's first strategy update",
      ]),
      risks: J([
        "Branded checkout decline accelerating rather than grinding",
        "Braintree growth diluting margin without adding value",
        "A platform-level change to how checkout works",
      ]),
      falsifiers: J([
        "Branded checkout volume growth turning negative",
        "Transaction margin dollars declining year-on-year",
        "A major platform bundling checkout in a way that removes the need for a branded button",
      ]),
      horizon: "18–24 months",
      addCondition: "Below $55 with branded volume growth still positive.",
      trimCondition: "On a re-rate above 16x forward.",
      exitCondition: "Branded checkout volume growth turning negative.",
      confidence: 4,
      changeNote: null,
    },
    {
      id: "th_pypl_2",
      positionId: "pos_pypl",
      versionNo: 2,
      occurredAt: d(300),
      summary:
        "The habit is eroding faster than gradually. The cheapness is real and no longer sufficient.",
      marketView: "The market's structural-decline view is being confirmed quarter by quarter.",
      variantView:
        "I no longer have a variant view worth holding. Branded checkout growth has decelerated three quarters in a row and the last print was roughly flat. My thesis needed 'gradual' and I am getting 'accelerating'. The buyback is doing its job and it is not enough. I am recording this now so that the exit, when it comes, is not a reaction to price.",
      assumptions: J([
        { id: "a1", text: "Branded checkout volume growth stays positive, even if low single digit.", status: "weakening" },
        { id: "a2", text: "Transaction margin dollars grow, carried by cost discipline.", status: "intact" },
        { id: "a3", text: "Buyback continues at 5%+ of shares annually.", status: "intact" },
        { id: "a4", text: "No large platform makes branded checkout structurally unnecessary.", status: "weakening" },
      ]),
      catalysts: J(["Next branded checkout volume print — this is the falsifier test"]),
      risks: J([
        "I am now holding this because it is cheap, which was never the thesis",
        "Value-trap dynamics: cheap and eroding",
      ]),
      falsifiers: J([
        "Branded checkout volume growth turning negative",
        "Transaction margin dollars declining year-on-year",
      ]),
      horizon: "Reduced to: one more quarter of evidence",
      addCondition: "None. Adding here would be averaging into an eroding asset.",
      trimCondition: "N/A — the decision is binary now.",
      exitCondition:
        "Branded checkout volume growth prints negative. Full exit, no partial.",
      confidence: 2,
      changeNote:
        "Confidence 4 → 2. Wrote the exit as binary and pre-committed to it so the eventual sale is a plan execution rather than a price reaction. a1 and a4 downgraded.",
    },

    {
      id: "th_smci_1",
      positionId: "pos_smci",
      versionNo: 1,
      occurredAt: d(262),
      summary:
        "A real beneficiary of the same capex wave I already own twice, at a lower quality of business and with disclosure I cannot verify.",
      marketView:
        "The market is treating it as a pure-play AI infrastructure winner with credible growth.",
      variantView:
        "The demand is real; the business is an assembler with thin, competitive margins and no durable moat. More importantly, I already express this bet through two positions with better economics. The interesting question is not whether it goes up — it is whether it adds anything to a book that is already long this belief. I do not think it does, and the accounting-controls disclosure means I cannot size it small enough to be worth the monitoring cost.",
      assumptions: J([
        { id: "a1", text: "Demand for AI server capacity is real and growing.", status: "intact" },
        { id: "a2", text: "Assembly margins are structurally thin and competed away.", status: "intact" },
        { id: "a3", text: "Reported financials are reliable.", status: "weakening" },
      ]),
      catalysts: J([
        "Auditor resolution and delayed filing",
        "Quarterly gross margin trajectory",
      ]),
      risks: J([
        "It works anyway and I look wrong for a long time",
        "Missing the highest-beta expression of a belief I hold strongly",
      ]),
      falsifiers: J([
        "Auditor issues resolved cleanly AND gross margin holding above 14% — that combination would mean I was wrong about the business, not just early",
      ]),
      horizon: "N/A — passed",
      addCondition: "N/A",
      trimCondition: "N/A",
      exitCondition: "N/A",
      confidence: 3,
      changeNote:
        "Written to document a pass, not a holding. If I had bought this it would have been a third expression of the data-center capex belief, which is the actual reason to decline.",
    },
  ];
  for (const t of theses) ins("thesis_versions", { ...t, createdAt: t.occurredAt });

  // ── Events ───────────────────────────────────────────────────────────────
  const events: Array<Record<string, unknown>> = [
    {
      id: "ev_nvda_q3",
      positionId: "pos_nvda",
      title: "NVIDIA Q3 results and FY27 commentary",
      kind: "earnings",
      occurredAt: d(-12),
      knownAt: d(25),
      status: "upcoming",
      marketExpects:
        "A beat-and-raise of roughly the usual magnitude. Consensus is anchored on the next-quarter guide and, more than anything, on whether gross margin holds above 72%. Positioning going in looks crowded and options are pricing a ~7% move.",
      iExpect:
        "The revenue number is not the variable. I expect the guide to be fine and the stock reaction to hinge entirely on the gross margin line and on any comment about packaging capacity additions. My honest expectation is a good print and a flat-to-down reaction, because the bar is now sentiment rather than numbers. I have been wrong about market reactions to this name twice.",
      keyVariables: J([
        "Gross margin — reported and guided (this is the a4 test)",
        "Any management framing of packaging capacity as easing (this is the a2 test)",
        "Customer concentration disclosure and the neocloud share of revenue (a5)",
        "FY27 capex commentary from the hyperscalers referenced on the call",
      ]),
      scenarios: J([
        {
          name: "Bull",
          probability: 30,
          expectedReaction: "+8 to +12%. Margin holds above 73%, packaging still described as constrained.",
          plannedAction:
            "Nothing. No add — I removed my add condition in thesis v3 and a good print does not restore it.",
        },
        {
          name: "Base",
          probability: 50,
          expectedReaction: "-2 to +4%. Good numbers, crowded positioning, margin roughly in line.",
          plannedAction:
            "Hold. Record the gross margin number against assumption a4 and the packaging language against a2.",
        },
        {
          name: "Bear",
          probability: 20,
          expectedReaction:
            "-10 to -18%. Margin guided below 72% with pricing mentioned, or packaging described as easing.",
          plannedAction:
            "If margin compression is attributed to pricing, that is falsifier one of two — do not act on a single quarter, but write the thesis update the same day and cut to a half position if the next quarter confirms.",
        },
      ]),
      outcome: null,
      resolvedAt: null,
    },
    {
      id: "ev_nvda_q2_past",
      positionId: "pos_nvda",
      // Must not hint at what was decided: this event is shown inside the sealed
      // Replay room for the add, where naming it gives the answer away.
      title: "NVIDIA Q2 results and next-quarter guide",
      kind: "earnings",
      occurredAt: d(292),
      knownAt: d(310),
      status: "resolved",
      marketExpects:
        "A beat, with the debate centred on whether a digestion pause arrives in the following two quarters. Sell-side notes are focused on customer concentration.",
      iExpect:
        "I expect management to be asked directly what limits shipments, and I expect the answer to be packaging. That is the whole reason I want to be larger before this print rather than after it.",
      keyVariables: J([
        "Whether management names supply as the constraint on the record",
        "Gross margin level",
        "Any widening of the disclosed customer base",
      ]),
      scenarios: J([
        {
          name: "Bull",
          probability: 45,
          expectedReaction: "+10%+. Supply named as the constraint, margin above 70%.",
          plannedAction: "Hold the enlarged position and update the thesis to reflect the confirmation.",
        },
        {
          name: "Base",
          probability: 40,
          expectedReaction: "+2 to +8%. Good print, no clean statement about the constraint.",
          plannedAction: "Hold. Wait for the next quarter for the constraint question.",
        },
        {
          name: "Bear",
          probability: 15,
          expectedReaction: "-8%. Digestion language, or margin guided down.",
          plannedAction: "Hold the original position, reverse the add if the constraint story is contradicted.",
        },
      ]),
      outcome: J({
        whatHappened:
          "Revenue and guidance beat. On the call management explicitly described advanced packaging capacity as the limit on shipments, and disclosure widened to include sovereign and neocloud buyers as a named revenue category.",
        actualReaction:
          "+9% over two sessions, then continued higher over the following month.",
        forecastAccurate: "yes",
        rightVariables: "yes",
        followedPlan: "yes",
        reactionSurprising: "no",
        notes:
          "This is the cleanest event of the book so far: I named the right variable, the variable resolved my way, and I had sized for it beforehand rather than chasing after. Worth noting for calibration that I rated this bull case at 45% and it landed — I should check whether I am generally this well-calibrated on business outcomes, because I suspect the answer is that I am good at these and bad at reaction forecasts.",
      }),
      resolvedAt: d(291),
    },
    {
      id: "ev_ceg_pjm",
      positionId: "pos_ceg",
      title: "PJM capacity auction results",
      kind: "regulatory",
      occurredAt: d(150),
      knownAt: d(190),
      status: "resolved",
      marketExpects:
        "A firm clearing price, up meaningfully year-on-year, but with the increase attributed to reserve margin mechanics rather than to data-center load.",
      iExpect:
        "I expect a large increase and, more importantly, I expect the market design to price scarcity rather than suppress it administratively. The clearing price matters less to me than what it proves about the mechanism.",
      keyVariables: J([
        "Clearing price versus prior auction",
        "Whether the increase is attributed to load growth or to reserve mechanics",
        "Any signal of administrative intervention or price caps being invoked",
      ]),
      scenarios: J([
        {
          name: "Bull",
          probability: 40,
          expectedReaction: "+10 to +15%. Clears sharply higher with load growth named as the driver.",
          plannedAction: "Add up to a full position — this confirms assumption a2, the one I was least sure of.",
        },
        {
          name: "Base",
          probability: 45,
          expectedReaction: "+3 to +8%. Clears higher on mechanics, load growth acknowledged but not central.",
          plannedAction: "Hold. Wait for a direct PPA as the a2 test instead.",
        },
        {
          name: "Bear",
          probability: 15,
          expectedReaction: "-10%. Price caps invoked or clearing flat despite rising load.",
          plannedAction: "Exit half. A capped auction would mean the scarcity cannot reach the generator.",
        },
      ]),
      outcome: J({
        whatHappened:
          "The auction cleared far above the prior year and above the top of the published range, with the operator's own commentary attributing the result to large-load interconnection demand. No price cap was invoked.",
        actualReaction: "+13% on the day, and the sector re-rated over the following weeks.",
        forecastAccurate: "yes",
        rightVariables: "yes",
        followedPlan: "yes",
        reactionSurprising: "no",
        notes:
          "I followed the plan and added, which is the part I want to reinforce. The uncomfortable observation is that this result created the political pressure that is now the biggest risk to the thesis — the confirmation and the new risk arrived in the same document. I updated the thesis to add the political-tolerance assumption rather than leaving it implicit.",
      }),
      resolvedAt: d(149),
    },
    {
      id: "ev_nke_q4",
      positionId: "pos_nke",
      title: "NIKE Q4 results and FY guidance",
      kind: "earnings",
      occurredAt: d(90),
      knownAt: d(115),
      status: "resolved",
      marketExpects:
        "A weak quarter with soft guidance. Expectations are low; the debate is whether the gross margin inflection appears at all.",
      iExpect:
        "I expect the margin line to inflect — clearance should be substantially complete by now. That is the entire reason I am still here. I expect wholesale commentary to be encouraging and I expect the market to ignore it.",
      keyVariables: J([
        "Gross margin, year-on-year — this is the a2 test",
        "Wholesale shelf-space commentary",
        "Whether the turnaround timeline is restated",
        "Greater China revenue trajectory",
      ]),
      scenarios: J([
        {
          name: "Bull",
          probability: 35,
          expectedReaction: "+8%. Margin inflects, wholesale improving, timeline held.",
          plannedAction: "Hold. No add — I have already used my add.",
        },
        {
          name: "Base",
          probability: 40,
          expectedReaction: "Flat to -5%. Margin roughly flat, wholesale improving, guidance cautious.",
          plannedAction: "Hold and give it one more quarter for the margin line.",
        },
        {
          name: "Bear",
          probability: 25,
          expectedReaction: "-10%. Margin down again, or the timeline is reset.",
          plannedAction:
            "A second timeline reset is a stated falsifier — cut to a half position rather than debating it.",
        },
      ]),
      outcome: J({
        whatHappened:
          "Gross margin declined year-on-year again, with management attributing it to continued promotional clearance and to a higher mix of wholesale. Wholesale shelf space did improve, materially and measurably. Guidance for the following year embedded a longer recovery than previously indicated, though management did not frame it as a reset. Greater China declined again.",
        actualReaction: "-7% on the print, then continued drifting lower.",
        forecastAccurate: "no",
        rightVariables: "yes",
        followedPlan: "no",
        reactionSurprising: "no",
        notes:
          "I picked the right variable and got it wrong. Margin did not inflect and the mechanism I was counting on — clearance completing — was partly offset by the wholesale mix I was also counting on, which I had not thought through: the two halves of my thesis work against each other on the margin line. On process: the guidance embedded a longer recovery, which I recorded as 'not technically a reset' rather than treating it as my falsifier. That is the failure worth keeping. I did not follow the plan.",
      }),
      resolvedAt: d(89),
    },
    {
      id: "ev_fcx_china",
      positionId: "pos_fcx",
      title: "China grid capex budget and stimulus follow-through",
      kind: "macro",
      occurredAt: d(6),
      knownAt: d(40),
      status: "upcoming",
      marketExpects:
        "Incremental stimulus language with limited hard commitment, and a grid budget roughly flat year-on-year.",
      iExpect:
        "Grid capex up, property support unchanged. The grid line is the one that matters for my thesis and the one the market will not focus on.",
      keyVariables: J([
        "State grid investment budget, year-on-year — this is the a1 test",
        "Whether stimulus is directed at property or at infrastructure",
        "Refined copper import and inventory data alongside it",
      ]),
      scenarios: J([
        {
          name: "Bull",
          probability: 35,
          expectedReaction: "Copper +4%, FCX +7%. Grid budget up double digits.",
          plannedAction: "Hold. The thesis is working and the position is already full size.",
        },
        {
          name: "Base",
          probability: 45,
          expectedReaction: "Little reaction. Grid up modestly, property support unchanged.",
          plannedAction: "Hold and record the grid number against a1.",
        },
        {
          name: "Bear",
          probability: 20,
          expectedReaction: "Copper -6%, FCX -10%. Grid capex guided flat or down.",
          plannedAction:
            "Grid capex guided down is a stated falsifier. Cut to a half position on confirmation, do not wait for the price to tell me.",
        },
      ]),
      outcome: null,
      resolvedAt: null,
    },
    {
      id: "ev_fomc",
      positionId: null,
      title: "FOMC September decision and the long end",
      kind: "macro",
      occurredAt: d(-34),
      knownAt: d(10),
      status: "upcoming",
      marketExpects:
        "A cut is largely priced. The market's attention is on the dot plot and the terminal rate, not the decision itself.",
      iExpect:
        "I have no edge on the decision and I am not going to pretend otherwise. I am recording this because two positions in the book are rate-sensitive and I want a written plan before the headline rather than a reaction after it.",
      keyVariables: J([
        "10-year yield after the statement, not the policy rate",
        "Any change to the terminal rate implied by the dots",
        "Credit spreads — the neocloud financing channel into the NVDA thesis runs through here",
      ]),
      scenarios: J([
        {
          name: "Bull",
          probability: 30,
          expectedReaction: "Long end rallies. DLR +5%, book broadly up.",
          plannedAction: "Nothing. Do not confuse a rate rally with thesis confirmation on DLR.",
        },
        {
          name: "Base",
          probability: 45,
          expectedReaction: "Cut delivered, long end roughly unchanged. Minimal book impact.",
          plannedAction: "Nothing.",
        },
        {
          name: "Bear",
          probability: 25,
          expectedReaction: "Long end sells off on terminal-rate revision. DLR -8%, credit spreads widen.",
          plannedAction:
            "Do not add to DLR on weakness — the a3 assumption is already weakening and a rate shock is the thing that breaks it. If credit spreads widen materially, revisit the neocloud assumption in the NVDA thesis, which is the non-obvious link.",
        },
      ]),
      outcome: null,
      resolvedAt: null,
    },
    {
      id: "ev_dlr_q3",
      positionId: "pos_dlr",
      title: "Digital Realty Q3 leasing and 2027 guidance",
      kind: "earnings",
      occurredAt: d(-40),
      knownAt: d(8),
      status: "upcoming",
      marketExpects: "Continued strong leasing with the debate on funding costs and development yields.",
      iExpect:
        "Releasing spreads above my base case again, and a refinancing disclosure that partly offsets it. The interesting number is the spread between new debt cost and development yield.",
      keyVariables: J([
        "Cash releasing spread on expiring capacity — the a1 test",
        "Weighted cost of new debt versus development yield — the a3 test",
        "Backlog and signed-not-commenced disclosure",
      ]),
      scenarios: J([
        {
          name: "Bull",
          probability: 30,
          expectedReaction: "+6%. Spreads strong, funding cost contained.",
          plannedAction: "Hold. Do not add — I decided in v2 to express new capex risk through equity, not a levered REIT.",
        },
        {
          name: "Base",
          probability: 45,
          expectedReaction: "Flat. Strong leasing offset by funding cost.",
          plannedAction: "Hold. Record both numbers against a1 and a3.",
        },
        {
          name: "Bear",
          probability: 25,
          expectedReaction: "-8%. New debt cost approaching development yields.",
          plannedAction: "That is the stated trim condition. Cut to a half position.",
        },
      ]),
      outcome: null,
      resolvedAt: null,
    },
  ];
  for (const e of events) ins("events", { ...e, portfolioId: PF, createdAt: e.knownAt });

  const eventBeliefs: Array<[string, string]> = [
    ["ev_nvda_q3", "bl_aicapex"],
    ["ev_nvda_q3", "bl_packaging"],
    ["ev_nvda_q2_past", "bl_aicapex"],
    ["ev_nvda_q2_past", "bl_packaging"],
    ["ev_ceg_pjm", "bl_reg"],
    ["ev_ceg_pjm", "bl_aicapex"],
    ["ev_nke_q4", "bl_consumer"],
    ["ev_nke_q4", "bl_china"],
    ["ev_fcx_china", "bl_china"],
    ["ev_fomc", "bl_rates"],
    ["ev_dlr_q3", "bl_aicapex"],
    ["ev_dlr_q3", "bl_rates"],
  ];
  const knownOn = new Map(events.map((e) => [e.id as string, e.knownAt as string]));
  eventBeliefs.forEach(([eventId, beliefId], i) =>
    ins("event_beliefs", {
      id: `eb_${i}`,
      eventId,
      beliefId,
      occurredAt: knownOn.get(eventId) ?? d(540),
    })
  );

  // ── Decisions ────────────────────────────────────────────────────────────
  const decisions: Array<Record<string, unknown>> = [
    {
      id: "dec_nvda_open",
      positionId: "pos_nvda",
      occurredAt: d(520),
      type: "open",
      what: "Open NVDA as the book's first position, 400 shares at $62.",
      why: "The constraint on accelerated computing is packaging capacity, not customer demand. If that is right, this is not a semiconductor cycle and the margin structure holds far longer than the market's model allows.",
      expectation:
        "Gross margin above 70% for at least four more quarters, and management naming supply rather than demand as the limiting factor within two quarters.",
      confidence: 4,
      mainRisk: "Customer concentration — five buyers are most of the revenue, and any one of them pausing resets the narrative.",
      reversalTrigger: "Gross margin compression attributed to pricing, or a hyperscaler guiding accelerator capex down.",
      linkedEventId: null,
      outcomeAt: d(300),
      outcomeNote:
        "Thesis played out as written: supply was named as the constraint on the Q2 call and margins held above 70% throughout.",
      outcomeVerdict: "worked",
    },
    {
      id: "dec_nvda_add",
      positionId: "pos_nvda",
      occurredAt: d(300),
      type: "add",
      what: "Add 180 shares at $91.50, taking NVDA from a quarter of the book to over a third, deliberately ahead of the Q2 print.",
      why: "The specific thing I want to own into this print is the answer to one question: what limits shipments? I think management says packaging, on the record, and I think that changes how the market frames the whole company — from a cyclical semi to a supply-allocated monopoly. If I wait for the answer I pay up for it. The risk of being early here is one bad quarter; the risk of being late is the entire re-rating.",
      expectation:
        "Management names supply as the constraint. Stock +10% or better on a two-week view. If instead they talk about digestion, I expect to be down 8% and to reverse the add rather than the position.",
      confidence: 5,
      mainRisk:
        "That I am sizing up into an event I cannot handicap, on a view about what an executive will say on a call. That is a communications forecast wearing a business-analysis costume.",
      reversalTrigger:
        "Management framing the limit as demand, or any digestion language in the guide. That contradicts the core of the thesis and I would take the add straight back off.",
      linkedEventId: "ev_nvda_q2_past",
      outcomeAt: d(291),
      outcomeNote:
        "Management named advanced packaging as the constraint explicitly. +9% over two sessions and it kept going. The add was correct — but I want to record that I rated this a 5 on a view about call language, which is not a repeatable edge.",
      outcomeVerdict: "worked",
    },
    {
      id: "dec_nvda_trim",
      positionId: "pos_nvda",
      occurredAt: d(120),
      type: "reduce",
      what: "Trim 120 shares at $128, taking the position down about a fifth.",
      why: "The position had grown past the 30% ceiling I wrote into the thesis at entry, so this is the written rule executing rather than a change of view. I want to record honestly that I also felt relief selling it — that is a separate thing from the rule, and if the rule had not existed I suspect I would have found a reason to sell anyway.",
      expectation:
        "No price expectation. I expect to be roughly indifferent on a two-year view and to have a book I can hold through a drawdown.",
      confidence: 3,
      mainRisk:
        "That a fixed weight ceiling makes me sell my best position for arithmetic reasons. The ceiling protects me from ruin and taxes me on being right.",
      reversalTrigger:
        "If the weight falls back below 25% on price alone I would not trim again — the ceiling would no longer be binding.",
      linkedEventId: null,
      outcomeAt: d(30),
      outcomeNote:
        "The stock went from $128 to $152 after the trim, so on price this cost me. On process it was right: the position had reached 38.7% of the book against a ceiling of 30% written at entry, and I sold because the rule said to, at a weight I can verify after the fact. Recording this as mixed rather than a failure — one instance going against a rule is not a reason to delete the rule, and the alternative was carrying a position I had already decided was too large.",
      outcomeVerdict: "mixed",
    },
    {
      id: "dec_nvda_hold",
      positionId: "pos_nvda",
      occurredAt: d(60),
      type: "hold",
      what: "Hold the full position through the last earnings print rather than reducing into it.",
      why: "Two assumptions are weakening but neither falsifier has fired. My own rule says falsifiers, not discomfort, drive action. Reducing into the print would be the trim decision repeated.",
      expectation: "A good print and a muted reaction. No action either way unless margin compression is attributed to pricing.",
      confidence: 4,
      mainRisk: "Holding a full position through an event I have explicitly said I cannot handicap.",
      reversalTrigger: "Gross margin guided below 72% with pricing named as the cause.",
      linkedEventId: null,
      outcomeAt: d(30),
      outcomeNote: "Good print, +7%. Held as planned. The process worked here specifically because I had a written rule to point at when I wanted to act on discomfort.",
      outcomeVerdict: "worked",
    },
    {
      id: "dec_ceg_open",
      positionId: "pos_ceg",
      occurredAt: d(400),
      type: "open",
      what: "Open CEG with 90 shares at $178 — deliberately a starter, not a full position.",
      why: "Existing firm baseload is the only supply that can serve a new 24/7 large load on the timeline data centers need. That scarcity should not carry a utility multiple. I am starting small because the mechanism — whether the scarcity value actually reaches the generator rather than being administratively suppressed — is unproven.",
      expectation:
        "A capacity auction or a direct PPA within twelve months that prices scarcity visibly. If that happens I want to be much larger.",
      confidence: 3,
      mainRisk: "Regulatory suppression. The scarcity can be real and still never reach the equity holder.",
      reversalTrigger: "An auction clearing flat despite rising load, or a price cap being invoked.",
      linkedEventId: null,
      outcomeAt: d(148),
      outcomeNote:
        "The PJM auction cleared far above range with load growth named as the driver. Mechanism confirmed. Starting small and sizing up on confirmation was the right structure.",
      outcomeVerdict: "worked",
    },
    {
      id: "dec_ceg_add",
      positionId: "pos_ceg",
      occurredAt: d(145),
      type: "add",
      what: "Add 40 shares at $258 following the auction result, taking CEG to a full position.",
      why: "This is the pre-committed bull-case action from the event plan. The auction confirmed assumption a2 — the one I was least sure of and the reason the position was small. With the mechanism proven the uncertainty that justified a starter size is gone.",
      expectation: "Continued re-rating as the market recognises the auction as repeatable rather than one-off.",
      confidence: 4,
      mainRisk: "Political backlash to retail bill increases — the same result that proved my mechanism is what creates this risk.",
      reversalTrigger: "Legislation or a regulatory order socialising large-load costs onto generators.",
      linkedEventId: "ev_ceg_pjm",
      outcomeAt: d(30),
      outcomeNote: "Position is up meaningfully since. More importantly, this is the one add I made by executing a plan written before the event rather than by reacting to the print.",
      outcomeVerdict: "worked",
    },
    {
      id: "dec_fcx_open",
      positionId: "pos_fcx",
      occurredAt: d(330),
      type: "open",
      what: "Open FCX at a full weight immediately, 600 shares at $44.20 — no scaling in.",
      why: "Copper is priced off Chinese property and the incremental demand is grid and electrification, which is price-insensitive and policy-driven. Supply cannot respond before 2028. I am going to full size at once because I do not have a catalyst to wait for; the mis-pricing is structural, not event-driven.",
      expectation: "Copper above $5.00/lb within eighteen months as grid demand shows up in inventory data.",
      confidence: 3,
      mainRisk: "Indonesian resource nationalism at Grasberg — a risk I genuinely cannot handicap and am taking anyway.",
      reversalTrigger: "Chinese grid capex guided down year-on-year, or an Indonesian ownership decision impairing Grasberg.",
      linkedEventId: null,
      outcomeAt: d(30),
      outcomeNote:
        "Up modestly, but on a wide round trip — it was underwater for most of the first year. The thesis has not been tested yet: the grid demand story has not clearly shown up in the price, and what I have earned so far is mostly copper beta, not my variant view.",
      outcomeVerdict: "mixed",
    },
    {
      id: "dec_dlr_open",
      positionId: "pos_dlr",
      occurredAt: d(250),
      type: "open",
      what: "Open DLR with 180 shares at $141, sized below a full weight.",
      why: "Power interconnection has turned data-center shell into a scarce-permit business. Existing capacity with power attached should re-lease at spreads REIT models do not contemplate.",
      expectation: "Double-digit cash releasing spreads for at least four quarters, and multiple expansion as the market re-frames this from rate-sensitive REIT to scarce asset.",
      confidence: 4,
      mainRisk: "It is a levered balance sheet, so I am short long rates whether or not that is a view I hold.",
      reversalTrigger: "Releasing spreads turning single-digit, or cost of new debt exceeding development yields.",
      linkedEventId: null,
      outcomeAt: d(90),
      outcomeNote:
        "Leasing has been better than I underwrote; financing has been worse. The position is up but roughly half the return path has been driven by the rate exposure rather than the thesis. Right conclusion, incomplete underwriting — I treated the rate exposure as incidental when it is half the outcome.",
      outcomeVerdict: "mixed",
    },
    {
      id: "dec_dlr_hedge",
      positionId: "pos_dlr",
      occurredAt: d(95),
      type: "hedge",
      what: "Put on a small rate hedge against the REIT exposure rather than reducing the position.",
      why: "The a3 assumption on cost of debt is weakening and I do not want to exit a working thesis because of an exposure that is incidental to it. Hedging the part I have no edge on lets me keep the part I do.",
      expectation: "Reduces the rate-driven variance without giving up the leasing upside. Costs a little carry.",
      confidence: 3,
      mainRisk: "Paying for a hedge on a risk that never materialises, and having hedged the wrong thing — my rate exposure is not a clean duration exposure.",
      reversalTrigger: "If cost of debt clearly stabilises below development yields, take the hedge off.",
      linkedEventId: null,
      outcomeAt: d(30),
      outcomeNote:
        "Cost carry with little benefit so far — rates have been roughly flat. Honest read: I am not sure this hedge maps cleanly onto the exposure I was worried about, and I would rather have expressed the concern through sizing.",
      outcomeVerdict: "mixed",
    },
    {
      id: "dec_nke_open",
      positionId: "pos_nke",
      occurredAt: d(210),
      type: "open",
      what: "Open NKE with 300 shares at $82.40, sized below a full weight given the turnaround risk.",
      why: "The damage is self-inflicted — a distribution mistake, not competitive displacement. Self-inflicted damage is repairable and the market is pricing permanent impairment. New management has already begun re-entering wholesale.",
      expectation: "Gross margin inflecting within three quarters as clearance completes, and visible wholesale shelf-space recovery.",
      confidence: 4,
      mainRisk: "That the competitive displacement is real and the distribution story is a comfortable explanation for a harder problem.",
      reversalTrigger: "Gross margin failing to inflect for three consecutive quarters, or a second reset of the turnaround timeline.",
      linkedEventId: null,
      outcomeAt: d(89),
      outcomeNote:
        "Down roughly 20% and the margin inflection has not appeared across three prints. The wholesale mechanism is working, which is the confusing part — the thing I said would happen is happening and the outcome I expected from it is not.",
      outcomeVerdict: "did_not_work",
    },
    {
      id: "dec_nke_add",
      positionId: "pos_nke",
      occurredAt: d(120),
      type: "add",
      what: "Add 120 shares at $71.60, taking NKE up to a full weight.",
      why: "Below $70 was my written add condition and this is close enough. Wholesale re-entry is measurably working — shelf space is coming back — and the market is treating a slow fix as no fix.",
      expectation: "Margin inflection at the next print, which should be the clearing event for the whole thesis.",
      confidence: 4,
      mainRisk: "Averaging down into a thesis where assumptions are weakening rather than strengthening.",
      reversalTrigger: "Margin failing to inflect at the Q4 print.",
      linkedEventId: null,
      outcomeAt: d(89),
      outcomeNote:
        "Margin did not inflect. Down again from here. The specific error: I wrote 'below $70' as an add condition without attaching it to the assumption set, so when three of four assumptions had weakened the price trigger still read as valid. A price condition without a thesis condition is not a plan.",
      outcomeVerdict: "did_not_work",
    },
    {
      id: "dec_nke_hold",
      positionId: "pos_nke",
      occurredAt: d(20),
      type: "hold",
      what: "Hold the full NKE position rather than cutting to a half, despite the evidence sitting against assumption a2.",
      why: "The guidance embedded a longer recovery but management did not frame it as a reset, and my falsifier is written as 'a second reset of the timeline by management'. On a strict reading it has not fired.",
      expectation: "One more quarter of evidence on the margin line before acting.",
      confidence: 2,
      mainRisk:
        "That I am reading my own falsifier as narrowly as possible in order to avoid acting on it. This is exactly the behaviour the falsifier was written to prevent.",
      reversalTrigger: "Any further margin decline, or wholesale partners reporting share loss.",
      linkedEventId: "ev_nke_q4",
      outcomeAt: null,
      outcomeNote: null,
      outcomeVerdict: null,
    },
    {
      id: "dec_nke_cut",
      positionId: "pos_nke",
      occurredAt: d(10),
      type: "reduce",
      what: "Cut NKE to a half position, selling 210 shares at $63.50.",
      why: "My thesis said that if the margin assumption moved to broken I would cut to a half position rather than debate it. Gross margin has now missed for four consecutive quarters and the clearance guidance has been extended again. The assumption is broken. I am doing what I said I would do, two quarters after I should have done it.",
      expectation:
        "No price view. This removes an exposure I can no longer defend at full size and leaves enough of a position that I keep paying attention.",
      confidence: 3,
      mainRisk:
        "That I am selling the bottom of a genuine turnaround because I got tired of being wrong, and that the wholesale recovery I correctly identified shows up in the numbers next year.",
      reversalTrigger: "",
      linkedEventId: null,
      outcomeAt: null,
      outcomeNote: null,
      outcomeVerdict: null,
    },
    {
      id: "dec_pypl_open",
      positionId: "pos_pypl",
      occurredAt: d(480),
      type: "open",
      what: "Open PYPL with 700 shares at $61.20, the second position in the book.",
      why: "Branded checkout is a habit business trading at a melting-ice-cube multiple. The share loss is real but slow, and at 11x I only need the decline to be gradual rather than reversed.",
      expectation: "Low-single-digit branded volume growth sustained, transaction margin dollars growing, 5%+ of shares retired annually.",
      confidence: 4,
      mainRisk: "That the erosion accelerates, at which point cheap becomes a trap rather than a cushion.",
      reversalTrigger: "Branded checkout volume growth turning negative.",
      linkedEventId: null,
      outcomeAt: d(240),
      outcomeNote:
        "Erosion accelerated instead of grinding. Branded volume decelerated three consecutive quarters and then went negative. Exited at a 10% loss. The falsifier was correctly specified in advance and it fired.",
      outcomeVerdict: "did_not_work",
    },
    {
      id: "dec_pypl_exit",
      positionId: "pos_pypl",
      occurredAt: d(240),
      type: "exit",
      what: "Sell the entire PYPL position, 700 shares at $55.10, for a loss of about 10%.",
      why: "Branded checkout volume growth printed negative. That is the falsifier I wrote at entry and restated in thesis v2 as a binary, full-exit condition. The stock being cheap is not a reason to stay — cheapness was the margin of safety on a thesis that required gradual erosion, and the erosion is no longer gradual.",
      expectation:
        "I have no price expectation and that is deliberate. This is a plan execution, not a forecast. If it rallies from here I still think selling was right.",
      confidence: 4,
      mainRisk: "That I am exiting at the point of maximum pessimism, which is where value investors are supposed to be buying.",
      reversalTrigger:
        "I would only re-enter if branded volume growth returned to positive for two consecutive quarters — that is a new thesis, not a continuation of this one.",
      linkedEventId: null,
      outcomeAt: d(30),
      outcomeNote:
        "The stock fell another 10% after the exit, then recovered to well above my sale price. On price alone the exit looks mediocre. On process it was the cleanest decision in the book: the falsifier was written in advance, it fired, and I acted without renegotiating it. I want to be careful not to learn the wrong lesson from the recovery.",
      outcomeVerdict: "worked",
    },
    {
      id: "dec_smci_pass",
      positionId: "pos_smci",
      occurredAt: d(260),
      type: "pass",
      what: "Pass on SMCI at $640 despite agreeing with the demand thesis.",
      why: "Two reasons, and the second is the real one. First, it is an assembler — thin, competed margins and no durable moat — and the accounting-controls disclosure means I cannot verify the numbers I would be underwriting. Second, and more important: I already own this belief twice, through NVDA and DLR. Adding a third expression of data-center capex would increase my exposure to the belief without adding any new information to the portfolio. The question is not whether it goes up; it is whether it adds anything.",
      expectation:
        "It may well go up a lot — that is not the same as it being a good position for this book. What I expect is that the margin structure gets competed away and that the filing issues take longer to resolve than the market assumes.",
      confidence: 3,
      mainRisk: "Missing the highest-beta expression of a belief I hold strongly, and looking wrong for a long time while doing so.",
      reversalTrigger:
        "Auditor issues resolved cleanly and gross margin holding above 14% — that combination would mean I was wrong about the business rather than merely early.",
      linkedEventId: null,
      outcomeAt: d(60),
      outcomeNote:
        "It ran from $640 to $930 over the eleven weeks after I passed — about +45% — and I had to sit with looking wrong. It then fell to $395. The reasoning that felt weakest at the time (concentration of belief, not the accounting) is the one that held up.",
      outcomeVerdict: "worked",
    },
    {
      id: "dec_thesis_nvda_v3",
      positionId: "pos_nvda",
      occurredAt: d(95),
      type: "thesis_change",
      what: "Downgrade NVDA assumptions a2 and a3 to weakening, shorten the horizon, and remove the add condition entirely.",
      why: "Packaging capacity additions are now visible and one large customer moved a production workload to internal silicon. Separately and more importantly: when the market came around to my view, my remaining edge became the durability of neocloud financing. That is a credit call, not a technology call, and it is not something I am good at. The thesis has drifted and the honest response is to write that down rather than to keep quoting the original one.",
      expectation:
        "No change in position size. I expect this to make me less willing to add on weakness, which is the point.",
      confidence: 4,
      mainRisk: "That writing down a drifted thesis becomes a way of holding a position I would not open today.",
      reversalTrigger: "If packaging tightens again or the internal-silicon workload migration stalls, a2 and a3 go back to intact.",
      linkedEventId: null,
      outcomeAt: null,
      outcomeNote: null,
      outcomeVerdict: null,
    },
  ];
  for (const dec of decisions) ins("decisions", { ...dec, portfolioId: PF, createdAt: dec.occurredAt });

  // ── Evidence ─────────────────────────────────────────────────────────────
  const evid: Array<Record<string, unknown>> = [
    {
      id: "evd_nvda_0a",
      positionId: "pos_nvda",
      occurredAt: d(340),
      kind: "fact",
      source: "Foundry Q4 earnings call",
      title: "Foundry describes advanced packaging capacity as fully booked through the next four quarters",
      body: "Asked about accelerator packaging specifically, management said capacity is allocated and that adding it is a multi-year build. No capacity expansion beyond what was already announced.",
      stance: "supports",
      contradictsAssumptionId: null,
    },
    {
      id: "evd_nvda_0b",
      positionId: "pos_nvda",
      occurredAt: d(316),
      kind: "fact",
      source: "Hyperscaler Q1 prints",
      title: "Three of four large cloud buyers raised full-year capex guidance",
      body: "Two framed the increase explicitly as accelerator capacity. The fourth held guidance but shifted mix toward compute.",
      stance: "supports",
      contradictsAssumptionId: null,
    },
    {
      id: "evd_nvda_0c",
      positionId: "pos_nvda",
      occurredAt: d(304),
      kind: "interpretation",
      source: "My own read",
      title: "The whole thesis reduces to one question on the next call",
      body: "Everything I believe about this position depends on whether the limit is supply or demand, and management has never said which on the record. If they name packaging, the market has to re-frame the company from a cyclical semi to a supply-allocated monopoly, and that re-rating is not something I can buy after the fact. If they talk about digestion instead, I am wrong about the central claim and not merely early. I would rather own the answer than wait for it — while noting that this makes me a forecaster of call language, which is not a durable edge.",
      stance: "neutral",
      contradictsAssumptionId: null,
    },
    {
      id: "evd_nvda_1",
      positionId: "pos_nvda",
      occurredAt: d(291),
      kind: "fact",
      source: "Q2 earnings call transcript",
      title: "Management names advanced packaging as the shipment constraint",
      body: "Asked directly what limits shipments, the CFO answered that advanced packaging capacity is the binding constraint and that the company is supply-limited rather than demand-limited. First time this has been stated in those terms on the record.",
      stance: "supports",
      contradictsAssumptionId: null,
    },
    {
      id: "evd_nvda_2",
      positionId: "pos_nvda",
      occurredAt: d(150),
      kind: "fact",
      source: "Foundry quarterly capex disclosure",
      title: "Foundry guides advanced packaging capacity up roughly 2x over eight quarters",
      body: "Capacity additions are now scheduled and disclosed rather than speculative. Order growth would need to keep pace for the constraint to remain binding.",
      stance: "contradicts",
      contradictsAssumptionId: "a2",
    },
    {
      id: "evd_nvda_3",
      positionId: "pos_nvda",
      occurredAt: d(110),
      kind: "fact",
      source: "Customer infrastructure blog post and conference remarks",
      title: "A top-five customer moves a flagship production workload to internal silicon",
      body: "Framed publicly as complementary and cost-motivated for inference specifically. The workload in question is a production one, not an experiment.",
      stance: "contradicts",
      contradictsAssumptionId: "a3",
    },
    {
      id: "evd_nvda_4",
      positionId: "pos_nvda",
      occurredAt: d(100),
      kind: "interpretation",
      source: "My own read",
      title: "My edge has quietly become a credit call",
      body: "Working through the customer list: the incremental buyer over the last three quarters is increasingly financed rather than cash-funded. If neocloud demand is credit-dependent, then my thesis now rests on financing conditions staying loose — which is not the thing I claimed to know. The technology view is now consensus and the non-consensus part of my position is something I have no particular skill at assessing.",
      stance: "contradicts",
      contradictsAssumptionId: "a5",
    },
    {
      id: "evd_nvda_5",
      positionId: "pos_nvda",
      occurredAt: d(30),
      kind: "fact",
      source: "Q2 reported results",
      title: "Gross margin holds at 73.4%, no pricing commentary",
      body: "Margin above the 70% threshold in assumption a4 for the eighth consecutive quarter, with mix rather than pricing cited for the sequential change.",
      stance: "supports",
      contradictsAssumptionId: null,
    },
    {
      id: "evd_ceg_1",
      positionId: "pos_ceg",
      occurredAt: d(149),
      kind: "fact",
      source: "Grid operator auction results and accompanying commentary",
      title: "Capacity auction clears above the published range, load growth named as the driver",
      body: "The operator's own commentary attributes the clearing price to large-load interconnection demand. No price cap invoked.",
      stance: "supports",
      contradictsAssumptionId: null,
    },
    {
      id: "evd_ceg_2",
      positionId: "pos_ceg",
      occurredAt: d(70),
      kind: "fact",
      source: "State legislative docket and consumer advocate filing",
      title: "Consumer advocates file to socialise large-load interconnection costs",
      body: "A filing in one state would allocate a share of large-load-driven capacity costs away from the loads and onto generators. Early stage, but the first concrete instance of the political risk.",
      stance: "contradicts",
      contradictsAssumptionId: "a4",
    },
    {
      id: "evd_ceg_3",
      positionId: "pos_ceg",
      occurredAt: d(45),
      kind: "interpretation",
      source: "My own read",
      title: "The confirmation and the risk arrived in the same document",
      body: "The auction result that proved the pass-through mechanism is precisely what made retail bills a political story. I should expect the strength of this thesis to generate its own opposition, and I should stop treating regulatory risk as a tail — it is the mechanism working, viewed from the other side.",
      stance: "neutral",
      contradictsAssumptionId: null,
    },
    {
      id: "evd_fcx_1",
      positionId: "pos_fcx",
      occurredAt: d(120),
      kind: "fact",
      source: "State grid operator investment plan",
      title: "Chinese state grid investment budget guided up 12% year-on-year",
      body: "Directionally supports assumption a1: grid capex is growing even as property construction remains weak.",
      stance: "supports",
      contradictsAssumptionId: null,
    },
    {
      id: "evd_fcx_2",
      positionId: "pos_fcx",
      occurredAt: d(75),
      kind: "fact",
      source: "Company quarterly production report",
      title: "Unit costs up 9% year-on-year against realised price up 6%",
      body: "One quarter of costs rising faster than realised price. The stated falsifier requires two consecutive quarters.",
      stance: "contradicts",
      contradictsAssumptionId: "a4",
    },
    {
      id: "evd_fcx_3",
      positionId: "pos_fcx",
      occurredAt: d(35),
      kind: "interpretation",
      source: "My own read",
      title: "I have been paid for copper beta, not for my actual view",
      body: "The position is up and the reason is broadly the copper price, not any visible grid-demand mix shift. If I am honest, the thesis has not been tested yet — I should not count this as evidence that I was right about anything.",
      stance: "neutral",
      contradictsAssumptionId: null,
    },
    {
      id: "evd_dlr_1",
      positionId: "pos_dlr",
      occurredAt: d(160),
      kind: "fact",
      source: "Quarterly leasing disclosure",
      title: "Cash releasing spreads print at +18%, well above my base case",
      body: "Third consecutive quarter of double-digit spreads. Assumption a1 is comfortably intact and running ahead of underwriting.",
      stance: "supports",
      contradictsAssumptionId: null,
    },
    {
      id: "evd_dlr_2",
      positionId: "pos_dlr",
      occurredAt: d(92),
      kind: "fact",
      source: "Refinancing pricing announcement",
      title: "New unsecured debt priced above my assumed cost of capital",
      body: "The weighted cost of new debt came in materially above the assumption embedded in a3, narrowing the spread to development yields.",
      stance: "contradicts",
      contradictsAssumptionId: "a3",
    },
    {
      id: "evd_nke_1",
      positionId: "pos_nke",
      occurredAt: d(140),
      kind: "fact",
      source: "Wholesale partner earnings calls",
      title: "Two large wholesale partners confirm Nike shelf space increasing",
      body: "Both named Nike as a growth driver for the coming season and described increased floor space allocation. The distribution mechanism in the thesis is measurably working.",
      stance: "supports",
      contradictsAssumptionId: null,
    },
    {
      id: "evd_nke_2",
      positionId: "pos_nke",
      occurredAt: d(89),
      kind: "fact",
      source: "Q4 results",
      title: "Gross margin declines year-on-year for the third consecutive quarter",
      body: "Management attributes the decline to continued promotional clearance and to a higher wholesale mix. Both explanations are internally consistent, and together they mean the two halves of my thesis work against each other on the margin line.",
      stance: "contradicts",
      contradictsAssumptionId: "a2",
    },
    {
      id: "evd_nke_3",
      positionId: "pos_nke",
      occurredAt: d(88),
      kind: "interpretation",
      source: "My own read",
      title: "Three consecutive quarters is my stated falsifier and I am arguing with the wording",
      body: "My falsifier reads 'gross margin failing to inflect for three consecutive quarters'. That has now happened. I have been telling myself the mix explanation makes this different, and separately that the guidance was not technically a reset. Both of those may be true and neither is why I am holding.",
      stance: "contradicts",
      contradictsAssumptionId: "a2",
    },
    {
      id: "evd_nke_4",
      positionId: "pos_nke",
      occurredAt: d(18),
      kind: "fact",
      source: "Q1 10-Q and supplemental disclosure",
      title: "Fourth consecutive quarter without margin inflection; clearance guidance extended again",
      body: "Gross margin down again year-on-year. The disclosure extends expected clearance activity by two further quarters, and Greater China declined again. The margin recovery assumption now has no quarter in which it has been true.",
      stance: "contradicts",
      contradictsAssumptionId: "a2",
    },
    {
      id: "evd_nke_5",
      positionId: "pos_nke",
      occurredAt: d(16),
      kind: "fact",
      source: "Trade press and channel checks",
      title: "Competitor running brands gain share in specialty channel for a fourth season",
      body: "Specialty running share continues to shift. This is the evidence for the alternative explanation I named as my main risk at entry: competitive displacement rather than self-inflicted distribution damage.",
      stance: "contradicts",
      contradictsAssumptionId: "a1",
    },
    {
      id: "evd_pypl_1",
      positionId: "pos_pypl",
      occurredAt: d(305),
      kind: "fact",
      source: "Quarterly results",
      title: "Branded checkout volume growth decelerates for the third consecutive quarter",
      body: "Growth roughly flat, down from low single digits. Not yet negative, which is the stated falsifier.",
      stance: "contradicts",
      contradictsAssumptionId: "a1",
    },
    {
      id: "evd_pypl_2",
      positionId: "pos_pypl",
      occurredAt: d(241),
      kind: "fact",
      source: "Quarterly results",
      title: "Branded checkout volume growth prints negative",
      body: "The stated falsifier has fired, exactly as specified at entry and restated in thesis v2 as a binary exit condition.",
      stance: "contradicts",
      contradictsAssumptionId: "a1",
    },
    {
      id: "evd_smci_1",
      positionId: "pos_smci",
      occurredAt: d(261),
      kind: "fact",
      source: "Company filing and auditor correspondence",
      title: "Filing delayed; auditor raises internal control concerns",
      body: "The financials I would be underwriting cannot currently be verified.",
      stance: "supports",
      contradictsAssumptionId: null,
    },
    {
      id: "evd_smci_2",
      positionId: "pos_smci",
      occurredAt: d(180),
      kind: "interpretation",
      source: "My own read",
      title: "Up 45% since I passed and my reasoning has not changed",
      body: "This is the uncomfortable part of a pass: there is no position to review, only a decision to sit with. Nothing in the weeks since has addressed either the margin structure or the filing issue. The price is not evidence.",
      stance: "neutral",
      contradictsAssumptionId: null,
    },
  ];
  for (const e of evid) ins("evidence", { ...e, createdAt: e.occurredAt });

  // ── Postmortem ───────────────────────────────────────────────────────────
  ins("postmortems", {
    id: "pm_pypl",
    positionId: "pos_pypl",
    decisionId: "dec_pypl_exit",
    occurredAt: d(235),
    verdicts: J({
      thesisCorrect: "no",
      thesisNote:
        "The thesis required gradual erosion of branded checkout and the erosion accelerated. The central claim was wrong, not merely early.",
      valuationRight: "partly",
      valuationNote:
        "11x was genuinely cheap on the numbers as they stood. What I got wrong is that cheapness was doing the work of a margin of safety on a deteriorating asset, where it functions as a discount rate on a shrinking stream instead.",
      sizingRight: "partly",
      sizingNote:
        "Confidence 4 out of 5 with a clearly specified falsifier, and the loss was under 10% of the position — survivable, and the falsifier is why. But this was a large share of a five-name book at the time, and I should not pretend a concentrated position was prudently sized just because the outcome was mild.",
      timingRight: "partly",
      timingNote:
        "Entry was reasonable. Exit was on the day the falsifier printed, which is the right rule — but the deceleration was visible three quarters earlier and I chose to wait for the binary trigger rather than reduce along the way. Correct by my rule; the rule may be too coarse.",
      followedProcess: "yes",
      processNote:
        "The falsifier was written at entry, restated as binary in thesis v2, and executed without renegotiation on the day it fired. This is the part I want to repeat.",
      drivenBy: "skill",
      drivenByNote:
        "The outcome was a loss and the process was the best in the book. Worth being explicit: the stock later recovered to well above my sale price, which means a price-based scorecard would call this a mistake. It was not. I was wrong about the business and right about how to handle being wrong.",
    }),
    lesson:
      "A pre-committed falsifier converts an emotional decision into an administrative one. That is its entire value, and it delivered — I sold a cheap stock at a loss near peak pessimism without renegotiating with myself, which I do not believe I would have managed otherwise. The separate lesson is subtler: cheapness is not a margin of safety when the underlying stream is shrinking, because the multiple is not mis-priced, it is correctly pricing decline. I should stop letting a low multiple substitute for a reason the decline will stop.",
    processChange:
      "Two changes. First: a binary falsifier is necessary but too coarse on its own — for any thesis that depends on a rate of change, I will write an intermediate trim trigger as well, so that three quarters of visible deterioration produces an action rather than a wait. Second: when I write 'cheap' in a thesis, I have to name what stops the decline. If I cannot, the position gets half the size.",
    createdAt: d(235),
  });

  // ── One prior replay attempt, so the feature isn't empty on first visit ──
  ins("replay_attempts", {
    id: "rp_seed_1",
    decisionId: "dec_nke_add",
    createdAt: d(12),
    newChoice: "hold",
    newReasoning:
      "Looking at only what I had at the time: the wholesale evidence was genuinely good, but assumption a2 was already marked weakening and my add condition was written purely as a price level. I do not think I would add again — the price trigger was satisfied and the thesis trigger was not, and I now think the add condition was badly written rather than badly executed.",
    newConfidence: 3,
    hindsightNote:
      "Hard to separate. I know the margin did not inflect, so 'I would have held' is suspiciously convenient. What I can defend independently of the outcome is narrower: the add condition should never have been a bare price level.",
  });

  return { seededAt: now };
}
