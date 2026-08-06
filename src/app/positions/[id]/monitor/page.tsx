import { notFound } from "next/navigation";
import { addMonitor } from "@/lib/actions";
import { getPositionSnapshot, listBeliefs } from "@/lib/queries";
import { symbolsToTrack } from "@/lib/correlation-report";
import { ChipRadio, FormBlock, Prose, Row, TextField } from "@/components/forms";
import { ActionForm } from "@/components/action-form";
import { PageHeader } from "@/components/ui";

export default async function NewMonitorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = getPositionSnapshot(id);
  if (!p) notFound();
  const beliefs = listBeliefs();
  const tracked = symbolsToTrack();

  return (
    <>
      <PageHeader
        eyebrow={`${p.ticker} · watch a condition`}
        title="Bind a written condition to something observable"
        lede="A falsifier written as prose waits for you to notice it. Given a symbol, a comparator and a threshold, it can tell you itself — and when it does, it lands on the timeline as evidence against the assumption it speaks for, exactly as if you had spotted it."
      />

      <ActionForm
        action={addMonitor}
        submitLabel="Start watching"
        cancelHref={`/positions/${id}`}
        className="max-w-[820px]"
        note="Checked whenever prices are refreshed. Only a change of state is recorded, so a condition that stays met stays quiet."
      >
        <input type="hidden" name="positionId" value={id} />

        <FormBlock label="What are you watching for" title="Name it the way you would say it out loud.">
          <TextField
            label="Condition"
            name="label"
            required
            placeholder="A 25% drawdown with the packaging constraint unchanged"
          />
          <ChipRadio
            label="Kind"
            name="kind"
            defaultValue="drawdown"
            hint="A level compares the latest close to a number. A move and a drawdown compare it to where it was, over a window you choose. A deadline just watches a date go by."
            options={[
              { value: "price_level", label: "Price level" },
              { value: "drawdown", label: "Drawdown from a high" },
              { value: "price_change", label: "Price move" },
              { value: "series_level", label: "Macro level" },
              { value: "series_change", label: "Macro move" },
              { value: "deadline", label: "A date passing" },
            ]}
          />
        </FormBlock>

        <FormBlock
          label="The observable"
          title="Any symbol with cached history — the position's own ticker, an index, or a commodity."
        >
          <Row cols={3}>
            <TextField
              label="Symbol"
              name="symbol"
              defaultValue={p.ticker}
              placeholder="NVDA, ^TNX, HG=F"
              hint={`Cached: ${tracked.slice(0, 8).join(", ")}${tracked.length > 8 ? "…" : ""}`}
            />
            <TextField
              label="Threshold"
              name="threshold"
              type="number"
              step="any"
              placeholder="-25"
              hint="A price for a level, a percentage for a move or drawdown."
            />
            <TextField
              label="Window (days)"
              name="windowDays"
              type="number"
              defaultValue={90}
              hint="Ignored for a level or a date."
            />
          </Row>
          <Row>
            <ChipRadio
              label="Fires when the reading is"
              name="comparator"
              defaultValue="below"
              options={[
                { value: "below", label: "Below the threshold" },
                { value: "above", label: "Above the threshold" },
              ]}
            />
            <TextField
              label="Or, for a deadline: by this date"
              name="byDate"
              type="date"
              hint="Only used when the kind is a date passing."
            />
          </Row>
        </FormBlock>

        {p.thesis && p.thesis.assumptions.length > 0 && (
          <FormBlock
            label="Which claim does this speak for?"
            title={`Against thesis v${p.thesis.versionNo}.`}
            hint="Linking it means a firing arrives as evidence against that assumption, and the attention queue can then tell you the thesis has not been revisited since."
          >
            <div className="space-y-2">
              <label className="chip w-full justify-start border-dashed">
                <input type="radio" name="assumptionId" value="" defaultChecked />
                Not tied to a specific assumption
              </label>
              {p.thesis.assumptions.map((a) => (
                <label key={a.id} className="chip w-full items-start justify-start text-left">
                  <input type="radio" name="assumptionId" value={a.id} />
                  <span className="leading-snug">
                    <span className="num mr-2 text-[10.5px] opacity-60">{a.id}</span>
                    {a.text}
                  </span>
                </label>
              ))}
            </div>
            {beliefs.length > 0 && (
              <label className="block">
                <span className="label">Belief it tests</span>
                <select className="field mt-1 text-[14px]" name="beliefId" defaultValue="">
                  <option value="">Not tied to a belief</option>
                  {beliefs.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </FormBlock>
        )}

        <FormBlock
          label="What would it mean"
          title="Written now, so a firing arrives with its interpretation attached."
        >
          <Prose
            label="If this fires, it means"
            name="meaning"
            rows={4}
            hint="The most useful version names the action, not just the observation. An alert you have to re-reason about at the moment it arrives is an alert you will argue with."
          />
        </FormBlock>
      </ActionForm>
    </>
  );
}
