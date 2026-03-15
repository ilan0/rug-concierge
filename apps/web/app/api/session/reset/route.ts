import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  normalizeTenantId,
  resolveAuthoritativeTenantForServer,
} from "@/lib/auth/tenant";
import { deleteSessionFromMemory } from "@/lib/chat/session-store";
import { parseJsonBodyWithSchema } from "@/lib/http/route-validation";

const RESET_SESSION_BODY_SCHEMA = z
  .object({
    session_id: z.string().trim().min(1).max(128).optional(),
    tenant_id: z.string().trim().min(1).max(128).optional(),
  })
  .strict();

function readOptionalSessionId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function POST(req: Request) {
  const parsedBody = await parseJsonBodyWithSchema(
    req,
    RESET_SESSION_BODY_SCHEMA,
    "Invalid request payload."
  );
  if (!parsedBody.ok) return parsedBody.response;

  const oldSessionId = readOptionalSessionId(parsedBody.value.session_id);

  const tenantId = resolveAuthoritativeTenantForServer({
    requestTenantId: normalizeTenantId(parsedBody.value.tenant_id),
  });

  if (oldSessionId && tenantId) {
    try {
      await supabaseAdmin
        .from("chat_messages")
        .delete()
        .eq("tenant_id", tenantId)
        .eq("session_id", oldSessionId);
    } catch {
      // Idempotent endpoint: ignore delete failures and continue.
    }

    try {
      await supabaseAdmin
        .from("chat_sessions")
        .delete()
        .eq("tenant_id", tenantId)
        .eq("session_id", oldSessionId);
    } catch {
      // Idempotent endpoint: ignore delete failures and continue.
    }

    deleteSessionFromMemory(oldSessionId);
  }

  return NextResponse.json({
    success: true,
    new_session_id: crypto.randomUUID(),
  });
}
