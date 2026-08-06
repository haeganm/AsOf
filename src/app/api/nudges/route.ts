import { NextResponse } from "next/server";
import { getDecisionNudges } from "@/lib/nudges";
import { DECISION_TYPES, type DecisionType } from "@/lib/types";

/**
 * What your record says about the decision being drafted.
 *
 * A route rather than server-rendered props because the action type is a radio
 * the user flips without navigating, and the nudges have to keep up with it.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const positionId = params.get("position");
  const raw = params.get("type") ?? "";
  const type = (DECISION_TYPES as string[]).includes(raw) ? (raw as DecisionType) : null;

  if (!positionId || !type) return NextResponse.json({ nudges: [] });
  return NextResponse.json({ nudges: getDecisionNudges(positionId, type) });
}
