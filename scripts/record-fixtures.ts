/**
 * Records trimmed real API responses into scripts/fixtures/ so the ingest and
 * correlation tests can run offline and deterministically.
 *
 *   npx tsx scripts/record-fixtures.ts
 *
 * Run this by hand when a provider changes shape — it is the only thing in the
 * repo that needs the network, and its output is checked in. Everything saved
 * here is public market/filing data; nothing personal goes in a fixture.
 */
import fs from "node:fs";
import path from "node:path";
import { getJson, getText } from "../src/lib/ingest/http";
import { ownershipXmlName } from "../src/lib/ingest/insiders";

const DIR = path.join(process.cwd(), "scripts", "fixtures");
fs.mkdirSync(DIR, { recursive: true });

const write = (name: string, data: unknown) => {
  const file = path.join(DIR, name);
  fs.writeFileSync(file, JSON.stringify(data, null, 1) + "\n");
  console.log(`  ${name.padEnd(28)} ${(fs.statSync(file).size / 1024).toFixed(1)} KB`);
};

/** Keeps a chart response shaped exactly like Yahoo's but small enough to read. */
function trimChart(raw: any, keep: number) {
  const res = raw?.chart?.result?.[0];
  if (!res) throw new Error("unexpected chart shape");
  const ts: number[] = res.timestamp ?? [];
  const close: Array<number | null> = res.indicators?.quote?.[0]?.close ?? [];
  const from = Math.max(0, ts.length - keep);
  return {
    chart: {
      result: [
        {
          meta: { symbol: res.meta?.symbol, currency: res.meta?.currency },
          timestamp: ts.slice(from),
          indicators: { quote: [{ close: close.slice(from) }] },
        },
      ],
      error: null,
    },
  };
}

async function main() {
  console.log("recording fixtures (public data only)\n");

  // 1. Weekly closes for the correlation tests: the four data-centre names, the
  //    consumer name that should sit apart, and the 10-year yield as a proxy.
  for (const sym of ["NVDA", "CEG", "FCX", "DLR", "NKE", "^TNX"]) {
    const raw = await getJson<any>(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=2y&interval=1wk`
    );
    write(`chart-${sym.replace(/[^A-Za-z0-9]/g, "_")}-2y-1wk.json`, trimChart(raw, 110));
  }

  // 2. A daily chart including Yahoo's null padding, which the parser must skip.
  const daily = await getJson<any>(
    "https://query1.finance.yahoo.com/v8/finance/chart/NVDA?range=1mo&interval=1d"
  );
  write("chart-NVDA-1mo-1d.json", trimChart(daily, 25));

  // 3. A slice of the SEC ticker universe, keeping the demo book's symbols.
  const universe = await getJson<Record<string, any>>(
    "https://www.sec.gov/files/company_tickers.json"
  );
  const wanted = new Set(["NVDA", "CEG", "FCX", "DLR", "NKE", "PYPL", "SMCI", "AAPL", "MSFT"]);
  const slice: Record<string, unknown> = {};
  let i = 0;
  for (const row of Object.values(universe)) {
    if (wanted.has(String(row.ticker).toUpperCase())) slice[String(i++)] = row;
  }
  write("sec-company-tickers-slice.json", slice);

  // 4. One company's filing feed, trimmed to the fields the parser reads.
  const subs = await getJson<any>("https://data.sec.gov/submissions/CIK0001045810.json");
  const r = subs.filings?.recent ?? {};
  const keep = 120;
  write("sec-submissions-NVDA.json", {
    cik: subs.cik,
    name: subs.name,
    filings: {
      recent: {
        accessionNumber: (r.accessionNumber ?? []).slice(0, keep),
        form: (r.form ?? []).slice(0, keep),
        filingDate: (r.filingDate ?? []).slice(0, keep),
        reportDate: (r.reportDate ?? []).slice(0, keep),
        primaryDocDescription: (r.primaryDocDescription ?? []).slice(0, keep),
        acceptanceDateTime: (r.acceptanceDateTime ?? []).slice(0, keep),
        items: (r.items ?? []).slice(0, keep),
      },
    },
  });

  // 5. One real Form 4: the filing directory index and its ownership XML.
  //    NVDA's most recent Form 4 (any will do — the schema is what matters).
  const form = (r.form ?? []) as string[];
  const f4 = form.findIndex((f: string) => f === "4");
  if (f4 === -1) throw new Error("no Form 4 in NVDA's recent filings");
  const accession = r.accessionNumber[f4] as string;
  const dir = `https://www.sec.gov/Archives/edgar/data/1045810/${accession.replace(/-/g, "")}`;
  const index = await getJson<any>(`${dir}/index.json`);
  write("sec-form4-index.json", index);
  const xmlName = ownershipXmlName(index);
  if (!xmlName) throw new Error("no ownership XML found in the Form 4 directory");
  const xml = await getText(`${dir}/${xmlName}`, { accept: "application/xml" });
  fs.writeFileSync(path.join(DIR, "sec-form4.xml"), xml);
  console.log(`  ${"sec-form4.xml".padEnd(28)} ${(xml.length / 1024).toFixed(1)} KB (${accession})`);

  console.log("\ndone. These are checked in; the tests never hit the network.");
}

main().catch((err) => {
  console.error(String(err));
  process.exit(1);
});
