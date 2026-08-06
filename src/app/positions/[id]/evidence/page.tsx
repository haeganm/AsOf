import { notFound } from "next/navigation";
import { addEvidence } from "@/lib/actions";
import { getPositionSnapshot } from "@/lib/queries";
import {
  ChipRadio,
  FormBlock,
  Prose,
  Row,
  TextField,
  todayValue,
} from "@/components/forms";
import { ActionForm } from "@/components/action-form";
import { PageHeader } from "@/components/ui";

export default async function AddEvidencePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = getPositionSnapshot(id);
  if (!p) notFound();

  return (
    <>
      <PageHeader
        eyebrow={`${p.ticker} · new entry`}
        title="Add something you learned"
        lede="Facts and readings are kept apart on purpose. A fact is something a sceptic could check; a reading is your inference from it. Conflating the two is how a thesis becomes unfalsifiable."
      />

      <ActionForm
        action={addEvidence}
        submitLabel="Add to the record"
        cancelHref={`/positions/${id}`}
        className="max-w-[760px]"
      >
        <input type="hidden" name="positionId" value={id} />

        <FormBlock label="What kind of entry">
          <ChipRadio
            label="Type"
            name="kind"
            defaultValue="fact"
            options={[
              { value: "fact", label: "Fact — checkable, with a source" },
              { value: "interpretation", label: "My read — my inference" },
            ]}
          />
          <Row>
            <TextField
              label="Source"
              name="source"
              placeholder="Q3 10-Q · earnings call · channel checks · my own read"
            />
            <TextField label="Date it became available" name="occurredAt" type="date" defaultValue={todayValue()} />
          </Row>
        </FormBlock>

        <FormBlock label="The entry">
          <TextField
            label="Headline"
            name="title"
            required
            placeholder="Gross margin declines year-on-year for the third consecutive quarter"
          />
          <Prose
            label="Detail"
            name="body"
            rows={5}
            placeholder="What was said, what the number was, and what it does or does not settle."
          />
        </FormBlock>

        {p.thesis && p.thesis.assumptions.length > 0 && (
          <FormBlock
            label="Does this touch an assumption?"
            title={`Against thesis v${p.thesis.versionNo}.`}
            hint="Linking evidence to an assumption is what lets AsOf tell you later that your thesis has not been revisited since. It never decides that the assumption is wrong — only that you have not looked."
          >
            <div className="space-y-2">
              <label className="chip w-full justify-start border-dashed">
                <input type="radio" name="contradictsAssumptionId" value="" defaultChecked />
                Neutral or supporting — nothing to flag
              </label>
              {p.thesis.assumptions.map((a) => (
                <label key={a.id} className="chip w-full items-start justify-start text-left">
                  <input type="radio" name="contradictsAssumptionId" value={a.id} />
                  <span className="leading-snug">
                    <span className="num mr-2 text-[10.5px] opacity-60">{a.id}</span>
                    Stands against: {a.text}
                  </span>
                </label>
              ))}
            </div>
            <ChipRadio
              label="If not against an assumption, how does it read?"
              name="stance"
              defaultValue="neutral"
              options={[
                { value: "supports", label: "Supports the thesis" },
                { value: "neutral", label: "Neither" },
              ]}
            />
          </FormBlock>
        )}

      </ActionForm>
    </>
  );
}
