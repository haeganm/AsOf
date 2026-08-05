import { notFound } from "next/navigation";
import { createPostmortem } from "@/lib/actions";
import { getPositionSnapshot, listDecisions, listThesisVersions } from "@/lib/queries";
import { shortDate, signedPct } from "@/lib/format";
import { ChipRadio, FormBlock, Prose, SubmitBar, VerdictPicker } from "@/components/forms";
import { PageHeader } from "@/components/ui";

const ROWS = [
  {
    key: "thesisCorrect",
    note: "thesisNote",
    q: "Was the thesis correct?",
    hint: "About the business. Answer this before you look at the price, or you will answer the price.",
  },
  {
    key: "valuationRight",
    note: "valuationNote",
    q: "Was the valuation judgment right?",
    hint: "Did you pay a sensible price for the outcome you were actually underwriting?",
  },
  {
    key: "sizingRight",
    note: "sizingNote",
    q: "Was the position sized appropriately?",
    hint: "Given the conviction you had at the time, not the one the outcome suggests you should have had.",
  },
  {
    key: "timingRight",
    note: "timingNote",
    q: "Was the timing good?",
    hint: "Including whether you acted when your own written rule told you to.",
  },
  {
    key: "followedProcess",
    note: "processNote",
    q: "Did you follow your process?",
    hint: "The only question here entirely within your control, and the one most worth being harsh about.",
  },
] as const;

export default async function NewPostmortemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = getPositionSnapshot(id);
  if (!p) notFound();
  const decisions = listDecisions({ positionId: id });
  const versions = listThesisVersions(id);

  return (
    <>
      <PageHeader
        eyebrow={`${p.ticker} · postmortem`}
        title="Separate the decision from the result"
        lede="A good decision can lose money and a bad one can make it. This form refuses to collapse into a single verdict on purpose — the useful information is in where the answers disagree with each other."
      />

      <section className="mb-11 border border-rule bg-wash px-5 py-5">
        <div className="label mb-3">Before you start, the record</div>
        <dl className="grid gap-x-8 gap-y-3 text-[12.5px] sm:grid-cols-3">
          <div>
            <dt className="text-ink-3">Return on average cost</dt>
            <dd className="num text-[15px]">{signedPct(p.returnPct)}</dd>
          </div>
          <div>
            <dt className="text-ink-3">Thesis versions</dt>
            <dd className="num text-[15px]">{versions.length}</dd>
          </div>
          <div>
            <dt className="text-ink-3">Decisions taken</dt>
            <dd className="num text-[15px]">{decisions.length}</dd>
          </div>
        </dl>
        {versions.length > 1 && (
          <p className="writing mt-4 border-t border-rule pt-4 text-[13px]">
            Your first thesis, from {shortDate(versions[versions.length - 1].occurredAt)}:{" "}
            <span className="italic">{versions[versions.length - 1].summary}</span>
          </p>
        )}
      </section>

      <form action={createPostmortem} className="max-w-[820px]">
        <input type="hidden" name="positionId" value={id} />

        {decisions.length > 0 && (
          <FormBlock label="Which decision is this about?" title="Optional — leave blank to review the whole position.">
            <label className="block">
              <span className="label">Decision</span>
              <select className="field mt-1 text-[14px]" name="decisionId" defaultValue="">
                <option value="">The position as a whole</option>
                {decisions.map((d) => (
                  <option key={d.id} value={d.id}>
                    {shortDate(d.occurredAt)} — {d.what.slice(0, 90)}
                  </option>
                ))}
              </select>
            </label>
          </FormBlock>
        )}

        <FormBlock label="The verdict grid" title="Answer each one on its own terms.">
          <div className="space-y-9">
            {ROWS.map((r) => (
              <div key={r.key} className="border-t border-rule pt-5 first:border-t-0 first:pt-0">
                <VerdictPicker label={r.q} name={r.key} hint={r.hint} />
                <div className="mt-4">
                  <Prose label="In a line" name={r.note} rows={2} />
                </div>
              </div>
            ))}
            <div className="border-t border-rule pt-5">
              <ChipRadio
                label="What actually drove the result?"
                name="drivenBy"
                defaultValue="skill"
                hint="Answering “skill” on a loss is allowed and is often the right answer. So is “luck” on a gain."
                options={[
                  { value: "skill", label: "Skill — the reasoning did the work" },
                  { value: "luck", label: "Luck — it went my way for other reasons" },
                  { value: "external", label: "Outside event — nothing to do with the thesis" },
                ]}
              />
              <div className="mt-4">
                <Prose label="In a line" name="drivenByNote" rows={2} />
              </div>
            </div>
          </div>
        </FormBlock>

        <FormBlock label="The lesson" title="Written so that it would be useful to a version of you who has forgotten this position.">
          <Prose
            label="What you take from this"
            name="lesson"
            required
            big
            rows={6}
            placeholder="The specific, transferable thing — not “be more patient”. If you cannot say what you would do differently, say that instead; a lesson you cannot name is worth recording as an open question."
          />
          <Prose
            label="What changes in your process"
            name="processChange"
            rows={4}
            hint="A lesson with no process change is a feeling. Leave it blank if nothing genuinely changes — that is an honest answer and a rarer one than it should be."
          />
        </FormBlock>

        <SubmitBar label="Save postmortem" cancelHref={`/positions/${id}`} />
      </form>
    </>
  );
}
