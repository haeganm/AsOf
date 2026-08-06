import { createPosition } from "@/lib/actions";
import { listBeliefs } from "@/lib/queries";
import {
  ChipRadio,
  ConfidencePicker,
  FormBlock,
  ListField,
  Prose,
  Row,
  TextField,
  todayValue,
} from "@/components/forms";
import { ActionForm } from "@/components/action-form";
import { PageHeader } from "@/components/ui";
import { InstrumentPicker } from "@/components/instrument-picker";

export default async function NewPositionPage() {
  const beliefs = listBeliefs();

  return (
    <>
      <PageHeader
        eyebrow="New position"
        title="Write the bet down before you take it"
        lede="Start with the sentence you would say out loud. The structure below exists to make that sentence checkable later — not to be filled in for its own sake. Only the summary and a ticker are required; everything else can be added as you learn it."
      />

      <ActionForm
        action={createPosition}
        submitLabel="Create position"
        cancelHref="/positions"
        note="This writes thesis v1 and an opening decision. Neither can be edited later — you update by adding a new version."
      >
        <FormBlock label="The bet" title="One sentence you would defend to a sceptical colleague.">
          <Prose
            label="Why this should work"
            name="summary"
            required
            big
            rows={3}
            placeholder="The constraint on accelerated computing is packaging capacity, not customer demand — which means margins hold far longer than a normal semi cycle."
          />
          <Row>
            <Prose
              label="What the market appears to believe"
              name="marketView"
              rows={4}
              placeholder="The consensus view you are trading against."
            />
            <Prose
              label="What you believe differently"
              name="variantView"
              rows={4}
              hint="If you cannot name a difference, you may be buying consensus at consensus prices."
              placeholder="Your variant view, and why you think you can see it."
            />
          </Row>
        </FormBlock>

        <FormBlock
          label="Instrument"
          title="Pick a real security, or type one in. Either way the price you enter is the opening mark."
        >
          <InstrumentPicker />
          <Row cols={3}>
            <TextField label="Shares" name="shares" type="number" step="any" placeholder="400" />
            <TextField label="Price" name="price" type="number" step="any" placeholder="62.00" />
            <TextField label="Date" name="occurredAt" type="date" defaultValue={todayValue()} />
          </Row>
          <ChipRadio
            label="How are you treating this?"
            name="kind"
            defaultValue="open"
            hint="A pass is recorded too. Ideas you declined are the cheapest lessons you own."
            options={[
              { value: "open", label: "Opening a position" },
              { value: "watching", label: "Watching, not yet owned" },
              { value: "passed", label: "Passing on it" },
            ]}
          />
        </FormBlock>

        <FormBlock
          label="What has to be true"
          title="The load-bearing claims. Each one becomes something evidence can later stand against."
        >
          <ListField
            label="Assumptions"
            name="assumptions_new"
            rows={5}
            placeholder={
              "Hyperscaler capex budgets grow, not merely re-mix, through FY27.\nPackaging capacity remains the binding constraint on units shipped.\nGross margin holds above 70% — no forced price defence."
            }
          />
          <ListField
            label="What would prove this wrong"
            name="falsifiers"
            rows={4}
            hint="Be specific enough that you could not argue your way out of it later."
            placeholder={
              "Two consecutive quarters of gross margin compression attributed to pricing.\nA hyperscaler guiding accelerator capex down year-on-year."
            }
          />
          <Row>
            <ListField label="Expected catalysts" name="catalysts" rows={4} />
            <ListField label="Main risks" name="risks" rows={4} />
          </Row>
        </FormBlock>

        <FormBlock label="Your rules" title="Written now, while you are calm and have no position to defend.">
          <TextField label="Time horizon" name="horizon" placeholder="24–36 months" />
          <Prose
            label="You would add if"
            name="addCondition"
            rows={2}
            hint="Tie this to the thesis, not only to a price. A price level and a broken assumption can be satisfied at the same moment."
          />
          <Row>
            <Prose label="You would trim if" name="trimCondition" rows={2} />
            <Prose label="You would exit if" name="exitCondition" rows={2} />
          </Row>
          <ConfidencePicker />
        </FormBlock>

        {beliefs.length > 0 && (
          <FormBlock
            label="Underlying beliefs"
            title="What this position actually expresses."
            hint="This is how AsOf finds out that four different tickers are one bet. Link at least one."
          >
            <div className="flex flex-wrap gap-1.5">
              {beliefs.map((b) => (
                <label key={b.id} className="chip">
                  <input type="checkbox" name="beliefIds" value={b.id} />
                  {b.name}
                </label>
              ))}
            </div>
          </FormBlock>
        )}

      </ActionForm>
    </>
  );
}
