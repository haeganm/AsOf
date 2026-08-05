import type { CheckResult } from "@/lib/correlation-report";
import { APART, TOGETHER } from "@/lib/correlation";
import { Badge } from "./ui";

/**
 * The declared belief graph, checked against the tape. Presented as a question
 * rather than a verdict: a moderate coefficient is not "the same position", and
 * a belief that has not yet shown up in price may simply be early.
 */
export function CorrelationCheck({ check }: { check: CheckResult }) {
  if (check.insufficient) {
    return (
      <div className="border border-dashed border-rule-2 px-5 py-6">
        <p className="writing text-[13.5px]">
          No price history cached yet, so there is nothing to check the belief graph against. Run{" "}
          <span className="num text-[12.5px]">npm run ingest</span> to pull two years of weekly
          closes for every symbol in the book.
        </p>
      </div>
    );
  }

  const shade = (r: number) => {
    const a = Math.min(1, Math.abs(r) / 0.6);
    // One ink, varying weight — negative correlation is outlined rather than filled.
    return r >= 0
      ? { background: `rgba(15,15,14,${(0.12 + a * 0.78).toFixed(2)})`, border: "1px solid #c9c9c5" }
      : { background: "#ffffff", border: `${Math.max(1, Math.round(a * 3))}px solid #0f0f0e` };
  };

  const keys = [...new Set(check.matrix.flatMap((m) => [m.a, m.b]))];
  const labelFor = (k: string) => check.labels[k] ?? k;
  const cell = (a: string, b: string) =>
    check.matrix.find((m) => (m.a === a && m.b === b) || (m.a === b && m.b === a));

  return (
    <>
      <div className="-mx-6 overflow-x-auto px-6 sm:mx-0 sm:px-0">
        <table className="w-full min-w-[560px] border-collapse">
          <thead>
            <tr>
              <th className="label border-b border-rule-2 pb-2 text-left font-medium">
                Realised correlation
              </th>
              {keys.map((k) => (
                <th key={k} className="num border-b border-rule-2 px-1 pb-2 text-center text-[11px] font-medium">
                  {labelFor(k)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-rule">
            {keys.map((a) => (
              <tr key={a}>
                <td className="num py-2 pr-4 text-[12px]">{labelFor(a)}</td>
                {keys.map((b) => {
                  if (a === b) {
                    return (
                      <td key={b} className="px-1 py-2 text-center">
                        <span className="inline-block h-[15px] w-[15px] bg-wash-2" />
                      </td>
                    );
                  }
                  const c = cell(a, b);
                  return (
                    <td key={b} className="px-1 py-2 text-center">
                      {c ? (
                        <span
                          title={`${labelFor(a)} vs ${labelFor(b)}: r = ${c.r.toFixed(2)} over ${c.n} weeks`}
                          className="inline-block h-[15px] w-[15px]"
                          style={shade(c.r)}
                        />
                      ) : (
                        <span className="inline-block h-[15px] w-[15px]" />
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-4 max-w-[76ch] text-[12px] leading-relaxed text-ink-3">
        Weekly returns over {check.weeksCovered} shared weeks. Darker means the two moved together
        more; an outlined cell means they moved <em>opposite</em> each other. Read a filled cell as
        “these move together more than the rest of the book” — {TOGETHER.toFixed(2)} is a
        relationship, not an identity. Anything under {APART.toFixed(2)} is treated as no visible
        link at all.
        {check.excluded.length > 0 && (
          <> Excluded for too little history: {check.excluded.join(", ")}.</>
        )}
        {check.missing.length > 0 && (
          <> No price series cached for {check.missing.join(", ")}.</>
        )}
      </p>

      {check.findings.length > 0 && (
        <ul className="mt-8 space-y-5">
          {check.findings.map((f, i) => (
            <li key={`${f.kind}-${i}`} className="border border-rule px-5 py-4">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Badge variant={f.kind === "correlated-but-undeclared" ? "solid" : "outline"}>
                  {f.kind === "declared-but-apart"
                    ? "Declared, not visible"
                    : f.kind === "correlated-but-undeclared"
                      ? "Undeclared overlap"
                      : "Stated exposure absent"}
                </Badge>
                <span className="num text-[11px] text-ink-3">
                  r = {f.r.toFixed(2)} · {f.n} weeks
                </span>
              </div>
              <p className="text-[14.5px] font-medium leading-snug">{f.headline}</p>
              <p className="writing mt-2 text-[13.5px]">{f.detail}</p>
            </li>
          ))}
        </ul>
      )}

      {check.findings.length === 0 && (
        <p className="writing mt-6 text-[13.5px]">
          Nothing to flag: every belief you have declared is visible in how the prices actually
          moved, and no two holdings move together without a recorded reason. That is the answer you
          want from this page.
        </p>
      )}
    </>
  );
}
