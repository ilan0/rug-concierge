import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJsonBodyWithSchema } from "@/lib/http/route-validation";
import { resolveTenantFromRequest } from "@/lib/tenant/resolve-tenant";

const RESET_SESSION_BODY_SCHEMA = z
  .object({
    session_id: z.string().trim().min(1).max(128).optional(),
  })
  .strict();

export async function POST(req: Request) {
  const tenantResolution = await resolveTenantFromRequest(req);
  if (!tenantResolution.ok) {
    return NextResponse.json(
      { error: tenantResolution.message },
      { status: tenantResolution.status }
    );
  }

  const parsedBody = await parseJsonBodyWithSchema(
    req,
    RESET_SESSION_BODY_SCHEMA,
    "Invalid request payload."
  );
  if (!parsedBody.ok) return parsedBody.response;

  // Starting a new visible chat should never erase historical transcripts.
  // The client clears its local UI and switches to this fresh session id.
  return NextResponse.json({
    success: true,
    new_session_id: crypto.randomUUID(),
  });
}
