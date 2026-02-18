import { NextResponse } from "next/server";
import {
  extractConstraintsFromUserMessage,
  mergeHardConstraints,
  normalizeHardConstraints,
} from "@/lib/filters/extract-constraints";
import { runRecommendationPipeline } from "@/lib/recommend/pipeline";

/**
 * POST /api/recommend
 * Recommendation-mode route only.
 * Input: optional `constraints`, optional `user_message`/`message`, and optional `tenant_id`.
 * Behavior: query Supabase with active hard constraints first, run backend hard checks, then ask AI to rank/explain.
 * Not for freeform chat; inventory truth stays in backend.
 */

// PSEUDOCODE
// 1) Parse request body and extract constraints + user message.
// 2) Normalize explicit constraints and parse lightweight constraints from user text.
// 3) Merge both sources into one backend constraint object.
// 4) Query Supabase for coarse candidate set (SQL-first hard filtering).
// 5) Apply deterministic hard-constraint filtering in backend code.
// 6) Shape candidates (bounded deterministic order) before AI ranking.
// 7) Return structured JSON for UI.

export async function POST(req: Request) {
  const requestId = crypto.randomUUID();

  // Parse JSON body safely. If parsing fails, `body` will be null.
  const body = await req.json().catch(() => null);

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  // `user_message` is preferred, but we also accept `message`.
  const userMessage =
    typeof body.user_message === "string"
      ? body.user_message
      : typeof body.message === "string"
        ? body.message
        : "";

  // Explicit request constraints come from UI payload.
  const explicitConstraints = normalizeHardConstraints(body.constraints);
  // Inferred constraints come from lightweight text parsing (e.g. "8x10-ish", "under $2k").
  const inferredConstraints = extractConstraintsFromUserMessage(userMessage);
  // Explicit values win when both sources are present.
  const constraints: HardConstraints = mergeHardConstraints(
    explicitConstraints,
    inferredConstraints
  );

  const tenantId =
    typeof body.tenant_id === "string" && body.tenant_id.trim()
      ? body.tenant_id.trim()
      : null;

  const result = await runRecommendationPipeline({
    requestId,
    tenantId,
    userMessage,
    constraints,
    promptContext: undefined,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: 500 }
    );
  }

  return NextResponse.json(result.response);
}
