import { recordDecision } from "@/lib/actions";
import { listEvents, listPositions } from "@/lib/queries";
import { DECISION_LABEL, DECISION_TYPES } from "@/lib/types";
import { shortDate } from "@/lib/format";
import {
  ChipRadio,
  ConfidencePicker,
  FormBlock,
  Prose,
  Row,
  SubmitBar,
  TextField,
  todayValue,
} from "@/components/forms";
import { PageHeader } from "@/components/ui";

export default async function NewDecisionPage({
  searchParams,
}: {
  searchParams: Promise<{ position?: string; type?: string; event?: string }>;
}) {
  const sp = await searchParams;
  const positions = listPositions();
  const upcoming = listEvents({ status: "upcoming" });

  return (
    <>
      <PageHeader
        eyebrow="New decision"
        title="Six answers, then get back to work"
        lede="This should take a minute. The value is not in the detail — it is in having written the expectation and the reversal trigger down before you know how it turns out."
      />

      <form action={recordDecision} className="max-w-[820px]">
        <FormBlock label="What you decided">
          <ChipRadio
            label="Action"
            name="type"
            defaultValue={sp.type ?? "hold"}
            options={DECISION_TYPES.map((t) => ({ value: t, label: DECISION_LABEL[t] }))}
          />
          <Row>
            <label className="block">
              <span className="label">Position</span>
              <select className="field mt-1 text-[14px]" name="positionId" defaultValue={sp.position ?? ""}>
                <option value="">No position — a book-level decision</option>
                {positions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.ticker} — {p.name}
                  </option>
                ))}
              </select>
            </label>
            <TextField label="Date" name="occurredAt" type="date" defaultValue={todayValue()} />
          </Row>
          <Prose
            label="The decision, in a sentence"
            name="what"
            required
            rows={2}
            placeholder="Trim 120 shares at $138, taking the position down about a quarter."
          />
        </FormBlock>

        <FormBlock label="Why" title="Written for the version of you that reads this in eighteen months.">
          <Prose
            label="Your reasoning"
            name="why"
            required
            big
            rows={5}
            placeholder="Say the real reason, including the parts that are not analysis. “The position had grown to an uncomfortable share of the book” is more useful to your future self than a tidy justification."
          />
          <Prose
            label="What you expect to happen"
            name="expectation"
            rows={3}
            hint="A specific, checkable expectation. If you have none, write that — it is itself a finding."
          />
        </FormBlock>

        <FormBlock label="The parts that hurt to write">
          <Prose
            label="Main risk"
            name="mainRisk"
            rows={3}
            placeholder="The way this decision most plausibly turns out to be wrong."
          />
          <Prose
            label="You would reverse this if"
            name="reversalTrigger"
            rows={3}
            hint="A decision with no reversal condition cannot be reviewed later — it can only be defended."
          />
          <ConfidencePicker />
          {upcoming.length > 0 && (
            <label className="block">
              <span className="label">Tied to an upcoming event</span>
              <select className="field mt-1 text-[14px]" name="linkedEventId" defaultValue={sp.event ?? ""}>
                <option value="">Not tied to an event</option>
                {upcoming.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.title} — {shortDate(e.occurredAt)}
                  </option>
                ))}
              </select>
            </label>
          )}
        </FormBlock>

        <FormBlock
          label="Size change"
          title="Optional. Fill this in only if the decision moved the position."
        >
          <Row>
            <TextField label="Shares" name="shares" type="number" step="any" placeholder="120" />
            <TextField label="Price" name="price" type="number" step="any" placeholder="138.00" />
          </Row>
          <p className="text-[11.5px] leading-snug text-ink-4">
            On a reduce or exit this is treated as shares sold. Selling the last share closes the
            position.
          </p>
        </FormBlock>

        <SubmitBar label="Record decision" cancelHref="/decisions" />
      </form>
    </>
  );
}
