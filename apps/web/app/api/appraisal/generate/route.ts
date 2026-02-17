import { NextResponse } from "next/server";
import { generateAppraisalDraft } from "@/lib/ai/appraisal";
import type { AppraisalInput } from "@/lib/types/appraisal";
import type { RoleType } from "@/lib/chat/types";

/**
 * POST /api/appraisal/generate
 * Staff-only endpoint for generating structured appraisal drafts.
 * This response is designed to be stable for future PDF/export mapping.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as
    | { role?: RoleType; appraisal_context?: AppraisalInput }
    | null;

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (body.role !== "store_staff") {
    return NextResponse.json(
      { error: "Appraisal generation is available only for store staff." },
      { status: 403 }
    );
  }

  const context =
    body.appraisal_context && typeof body.appraisal_context === "object"
      ? body.appraisal_context
      : {};

  const result = await generateAppraisalDraft(context);
  return NextResponse.json(result);
}
