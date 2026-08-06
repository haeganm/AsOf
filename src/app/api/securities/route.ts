import { NextResponse } from "next/server";
import { searchSecurities, universeSize } from "@/lib/ingest/securities";

/**
 * Symbol lookup for the instrument picker.
 *
 * Exists so choosing a ticker no longer navigates: the search used to be a GET
 * form that reloaded `/positions/new`, which threw away everything already typed
 * into the thesis.
 *
 * Reads only the locally cached universe — no outbound request, so typing is
 * fast and works offline.
 */
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 1) {
    return NextResponse.json({ results: [], universe: universeSize() });
  }
  return NextResponse.json({
    results: searchSecurities(q, 10),
    universe: universeSize(),
  });
}
