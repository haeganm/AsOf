import { createEvent } from "@/lib/actions";
import { listBeliefs, listPositions } from "@/lib/queries";
import {
  ChipRadio,
  FormBlock,
  ListField,
  Prose,
  Row,
  SubmitBar,
  TextField,
  todayValue,
} from "@/components/forms";
import { PageHeader } from "@/components/ui";

const SCENARIOS = [
  {
    name: "Bull",
    prob: 30,
    reaction: "+8 to +12% if the margin line holds and the constraint is described as unchanged.",
    action: "What you will actually do. “Nothing” is a legitimate and often correct answer.",
  },
  { name: "Base", prob: 50, reaction: "Roughly flat — good numbers into crowded positioning.", action: "" },
  { name: "Bear", prob: 20, reaction: "-10 to -18% if guidance embeds pricing pressure.", action: "" },
] as const;

export default function NewEventPage() {
  const positions = listPositions().filter((p) => p.status !== "passed");
  const beliefs = listBeliefs();

  return (
    <>
      <PageHeader
        eyebrow="New event"
        title="Decide now what you will do then"
        lede="The point of this page is that it is written in advance. Afterwards, AsOf will hold your expectation next to what happened and ask whether you did what you said you would."
      />

      <form action={createEvent} className="max-w-[860px]">
        <FormBlock label="The catalyst">
          <TextField
            label="What is happening"
            name="title"
            required
            placeholder="NVIDIA Q3 results and FY27 commentary"
          />
          <Row cols={3}>
            <TextField label="Date" name="occurredAt" type="date" required defaultValue={todayValue()} />
            <label className="block">
              <span className="label">Position</span>
              <select className="field mt-1 text-[14px]" name="positionId" defaultValue="">
                <option value="">Book-level — no single position</option>
                {positions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.ticker} — {p.name}
                  </option>
                ))}
              </select>
            </label>
            <div />
          </Row>
          <ChipRadio
            label="Kind"
            name="kind"
            defaultValue="earnings"
            options={[
              { value: "earnings", label: "Earnings" },
              { value: "macro", label: "Macro" },
              { value: "regulatory", label: "Regulatory" },
              { value: "product", label: "Product" },
              { value: "legal", label: "Legal" },
            ]}
          />
        </FormBlock>

        <FormBlock label="The two views" title="Yours only counts as a view where it differs from the market's.">
          <Row>
            <Prose
              label="What the market expects"
              name="marketExpects"
              rows={5}
              placeholder="Consensus, and what is already in the price. Positioning matters as much as the estimate."
            />
            <Prose
              label="What you expect"
              name="iExpect"
              rows={5}
              placeholder="Including your expectation for the reaction, which is a separate forecast from the outcome."
            />
          </Row>
          <ListField
            label="Variables that will actually decide it"
            name="keyVariables"
            rows={4}
            hint="Name each one specifically enough that you can check it off against a filing."
            placeholder={
              "Gross margin — reported and guided\nAny management framing of capacity as easing\nCustomer concentration disclosure"
            }
          />
        </FormBlock>

        <FormBlock
          label="Scenarios"
          title="Probabilities and, more importantly, the action for each."
          hint="The planned action is the part that pays for this exercise. Write what you will do, not what you might consider."
        >
          {SCENARIOS.map((s) => (
            <div key={s.name} className="border-t border-rule pt-5 first:border-t-0 first:pt-0">
              <div className="mb-4 flex items-center gap-4">
                <span className="label label-ink w-[52px]">{s.name}</span>
                <label className="flex items-baseline gap-2">
                  <input
                    className="field num w-[72px] text-center text-[14px]"
                    type="number"
                    min={0}
                    max={100}
                    name={`prob_${s.name}`}
                    defaultValue={s.prob}
                  />
                  <span className="text-[12px] text-ink-3">% probability</span>
                </label>
              </div>
              <div className="grid gap-5 sm:grid-cols-2">
                <Prose label="Expected reaction" name={`reaction_${s.name}`} rows={3} placeholder={s.reaction} />
                <Prose
                  label="What you will do"
                  name={`action_${s.name}`}
                  rows={3}
                  placeholder={s.action || "The action, decided now."}
                />
              </div>
            </div>
          ))}
        </FormBlock>

        {beliefs.length > 0 && (
          <FormBlock
            label="Beliefs this tests"
            title="How AsOf works out that one event reaches several positions."
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

        <SubmitBar
          label="Save the plan"
          cancelHref="/events"
          note="Frozen once saved. You record the outcome after the date passes."
        />
      </form>
    </>
  );
}
