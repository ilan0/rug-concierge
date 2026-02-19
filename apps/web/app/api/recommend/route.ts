import { NextResponse } from "next/server";
import {
  extractConstraintsFromUserMessage,
  mergeHardConstraints,
  normalizeHardConstraints,
} from "@/lib/filters/extract-constraints";
import { runRecommendationPipeline } from "@/lib/recommend/pipeline";
import { badRequest, internalError } from "@/lib/errors/http-errors";
import type { HardConstraints } from "@/lib/types/recommendation";

function hasMeaningfulConstraints(constraints: HardConstraints): boolean {
  return (
    typeof constraints.budgetMax === "number" ||
    Boolean(
      constraints.size &&
        typeof constraints.size.widthIn === "number" &&
        typeof constraints.size.lengthIn === "number"
    )
  );
}

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
  try {
    const requestId = crypto.randomUUID();

    // Parse JSON body safely. If parsing fails, `body` will be null.
    const body = await req.json().catch(() => null);

    if (!body || typeof body !== "object") {
      return badRequest("Invalid request");
    }

    // `user_message` is preferred, but we also accept `message`.
    const userMessage =
      typeof body.user_message === "string"
        ? body.user_message.trim()
        : typeof body.message === "string"
          ? body.message.trim()
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

    if (!userMessage && !hasMeaningfulConstraints(constraints)) {
      return badRequest(
        "Provide a message or at least one valid constraint (size and/or budget)."
      );
    }

    if (
      typeof constraints.budgetMax === "number" &&
      (!Number.isFinite(constraints.budgetMax) || constraints.budgetMax <= 0)
    ) {
      return badRequest("budgetMax must be a positive number.");
    }

    if (constraints.size) {
      const { widthIn, lengthIn, toleranceIn } = constraints.size;
      if (
        !Number.isFinite(widthIn) ||
        !Number.isFinite(lengthIn) ||
        widthIn <= 0 ||
        lengthIn <= 0
      ) {
        return badRequest("size widthIn/lengthIn must be positive numbers.");
      }
      if (
        toleranceIn !== undefined &&
        (!Number.isFinite(toleranceIn) || toleranceIn < 0)
      ) {
        return badRequest("size toleranceIn must be zero or a positive number.");
      }
    }

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
      return internalError(
        "Unable to run recommendation pipeline right now.",
        "RECOMMENDATION_PIPELINE_ERROR"
      );
    }

    return NextResponse.json(result.response);
  } catch {
    return internalError(
      "Unable to run recommendation pipeline right now.",
      "RECOMMENDATION_PIPELINE_ERROR"
    );
  }
}
