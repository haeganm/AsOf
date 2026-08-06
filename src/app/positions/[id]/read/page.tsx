import Link from "next/link";
import { notFound } from "next/navigation";
import { readDocument } from "@/lib/actions";
// From ai-config, not ai: the page only needs to know whether the feature is
// available, and this keeps the model SDK out of this route entirely.
import { aiEnabled, aiLabel } from "@/lib/ai-config";
import { getPositionSnapshot } from "@/lib/queries";
import { FormBlock, Prose, Row, TextField, todayValue } from "@/components/forms";
import { ActionForm } from "@/components/action-form";
import { Badge, PageHeader } from "@/components/ui";

export default async function ReadDocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = getPositionSnapshot(id);
  if (!p) notFound();

  if (!aiEnabled()) {
    return (
      <>
        <PageHeader
          eyebrow={`${p.ticker} · read a document`}
          title="No model is configured"
          lede="This is the one feature in AsOf that uses a language model. Every number, monitor and pattern is computed without one and is unaffected by this."
        />
        <div className="max-w-[760px] border border-rule bg-wash px-5 py-5">
          <p className="writing text-[14px]">
            To switch it on, put a key in <span className="num">.env.local</span> — which is
            gitignored, so it never leaves your machine:
          </p>
          <pre className="num mt-4 overflow-x-auto border border-rule bg-paper px-4 py-3 text-[12px] leading-relaxed">{`# one of these
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...

# optional: pick the exact model
ASOF_AI_MODEL=anthropic:claude-sonnet-4-5`}</pre>
          <p className="writing mt-4 text-[13.5px]">
            Restart the dev server afterwards. Nothing is sent anywhere until you press the button on
            this page, and the model is asked only to read — never to recommend a trade or predict a
            price.
          </p>
          <Link href={`/positions/${id}`} className="btn btn-quiet mt-5">
            Back to {p.ticker}
          </Link>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow={`${p.ticker} · read a document`}
        title="Read this against the thesis"
        lede="Paste a filing, a transcript or a note. The model is asked one question: which of your assumptions does this actually speak to, and with which sentence. It files what it finds as evidence you can edit or delete."
        actions={<Badge variant="quiet">{aiLabel()}</Badge>}
      />

      <div className="mb-9 max-w-[760px] border-l-[3px] border-ink pl-5">
        <p className="writing text-[13.5px]">
          What gets sent: the text you paste, your thesis summary, and your assumption list. Nothing
          else — not your holdings, not your returns, not your decisions. It happens only when you
          press the button, and what comes back is marked as drafted rather than written by you.
        </p>
      </div>

      <ActionForm
        action={readDocument}
        submitLabel="Read it against the thesis"
        cancelHref={`/positions/${id}`}
        className="max-w-[820px]"
        note="Filed as evidence marked 'ingested'. Wrong readings should be deleted — the model drafts, you own the record."
      >
        <input type="hidden" name="positionId" value={id} />

        <FormBlock label="Where it came from">
          <Row>
            <TextField
              label="Source"
              name="source"
              placeholder="Q3 10-Q · earnings call transcript · sell-side note"
            />
            <TextField
              label="Date it became available"
              name="occurredAt"
              type="date"
              defaultValue={todayValue()}
            />
          </Row>
        </FormBlock>

        <FormBlock
          label="The document"
          title={`Checked against thesis v${p.thesis?.versionNo ?? "—"} and its ${p.thesis?.assumptions.length ?? 0} assumptions.`}
        >
          <Prose
            label="Paste the text"
            name="document"
            required
            rows={18}
            hint="Long documents are truncated. The management discussion and the segment tables are usually where the assumptions actually get tested."
          />
        </FormBlock>
      </ActionForm>
    </>
  );
}
