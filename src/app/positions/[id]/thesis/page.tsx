import { notFound } from "next/navigation";
import { updateThesis } from "@/lib/actions";
import { getPositionSnapshot, listEvidence } from "@/lib/queries";
import { shortDate } from "@/lib/format";
import {
  ConfidencePicker,
  FormBlock,
  ListField,
  Prose,
  Row,
  SubmitBar,
  TextField,
} from "@/components/forms";
import { Badge, PageHeader } from "@/components/ui";

export default async function UpdateThesisPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = getPositionSnapshot(id);
  if (!p || !p.thesis) notFound();
  const current = p.thesis;
  const next = current.versionNo + 1;

  // Evidence recorded since the current version — the reason you are probably here.
  const since = listEvidence(id).filter((e) => e.occurredAt > current.occurredAt);
  const contradicting = since.filter((e) => e.contradictsAssumptionId);

  return (
    <>
      <PageHeader
        eyebrow={`${p.ticker} · thesis v${current.versionNo} → v${next}`}
        title="Update your current view"
        lede={`Version ${current.versionNo} stays exactly as you wrote it on ${shortDate(current.occurredAt)}. This form creates v${next} alongside it. You are not correcting the record — you are adding to it.`}
      />

      {since.length > 0 && (
        <section className="mb-10 border border-ink">
          <div className="sealed px-4 py-2.5">
            <span className="label label-ink text-paper!">
              {since.length} entr{since.length === 1 ? "y" : "ies"} since v{current.versionNo}
            </span>
          </div>
          <ul className="divide-y divide-rule">
            {since.slice(0, 6).map((e) => {
              const target = e.contradictsAssumptionId
                ? current.assumptions.find((a) => a.id === e.contradictsAssumptionId)
                : null;
              return (
                <li key={e.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="num text-[11px] text-ink-3">{shortDate(e.occurredAt)}</span>
                    <span className="text-[13.5px] font-medium">{e.title}</span>
                    {target && <Badge variant="outline">Against: {target.text.slice(0, 48)}…</Badge>}
                  </div>
                </li>
              );
            })}
          </ul>
          {contradicting.length > 0 && (
            <p className="writing border-t border-rule px-4 py-3 text-[13px]">
              AsOf does not know whether this evidence should change your mind. It only knows you
              have not said either way.
            </p>
          )}
        </section>
      )}

      <form action={updateThesis} className="max-w-[860px]">
        <input type="hidden" name="positionId" value={id} />

        <FormBlock
          label={`What changed`}
          title="This is the part your future self will read first."
        >
          <Prose
            label="Why you are writing a new version"
            name="changeNote"
            required
            rows={4}
            placeholder="Downgraded a2 to weakening after the refinancing came in above my assumed cost of debt. Lowered confidence and said the uncomfortable thing out loud: half of this position's outcome is a rate call I have no edge on."
          />
        </FormBlock>

        <FormBlock label="The bet, now">
          <Prose label="Why this should work" name="summary" required big rows={3} defaultValue={current.summary} />
          <Row>
            <Prose
              label="What the market appears to believe"
              name="marketView"
              rows={4}
              defaultValue={current.marketView ?? ""}
            />
            <Prose
              label="What you believe differently"
              name="variantView"
              rows={4}
              defaultValue={current.variantView ?? ""}
            />
          </Row>
        </FormBlock>

        <FormBlock
          label="Assumptions"
          title="Carried forward with their history. Marking one weak is not an admission — it is the point."
        >
          <ul className="space-y-5">
            {current.assumptions.map((a) => (
              <li key={a.id} className="border-t border-rule pt-4">
                <div className="mb-2 flex items-center gap-3">
                  <span className="num text-[10.5px] text-ink-4">{a.id}</span>
                  <span className="label">Currently {a.status}</span>
                </div>
                <input
                  className="field text-[13.5px]"
                  name={`asm_text_${a.id}`}
                  defaultValue={a.text}
                />
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  {(["intact", "weakening", "broken"] as const).map((s) => (
                    <label key={s} className="chip">
                      <input
                        type="radio"
                        name={`asm_status_${a.id}`}
                        value={s}
                        defaultChecked={a.status === s}
                      />
                      {s}
                    </label>
                  ))}
                  <label className="chip ml-2 border-dashed">
                    <input type="checkbox" name={`asm_drop_${a.id}`} />
                    No longer part of the thesis
                  </label>
                </div>
              </li>
            ))}
          </ul>
          <ListField
            label="New assumptions"
            name="assumptions_new"
            rows={3}
            hint="A thesis that quietly starts depending on something new is the most common way one drifts."
          />
        </FormBlock>

        <FormBlock label="Tests and rules">
          <ListField
            label="What would prove this wrong"
            name="falsifiers"
            rows={4}
            defaultValue={current.falsifiers}
          />
          <Row>
            <ListField label="Expected catalysts" name="catalysts" rows={4} defaultValue={current.catalysts} />
            <ListField label="Main risks" name="risks" rows={4} defaultValue={current.risks} />
          </Row>
          <TextField label="Time horizon" name="horizon" defaultValue={current.horizon ?? ""} />
          <Prose label="You would add if" name="addCondition" rows={2} defaultValue={current.addCondition ?? ""} />
          <Row>
            <Prose label="You would trim if" name="trimCondition" rows={2} defaultValue={current.trimCondition ?? ""} />
            <Prose label="You would exit if" name="exitCondition" rows={2} defaultValue={current.exitCondition ?? ""} />
          </Row>
          <ConfidencePicker defaultValue={current.confidence} />
        </FormBlock>

        <SubmitBar
          label={`Save as v${next}`}
          cancelHref={`/positions/${id}`}
          note={`v${current.versionNo} remains on the record unchanged.`}
        />
      </form>
    </>
  );
}
