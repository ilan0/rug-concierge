import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  normalizeTenantId,
  resolveAuthoritativeTenantForServer,
} from "@/lib/auth/tenant";
import { deleteSessionFromMemory } from "@/lib/chat/session-store";

function readOptionalSessionId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const oldSessionId = readOptionalSessionId(body.session_id);

  const tenantId = resolveAuthoritativeTenantForServer({
    requestTenantId: normalizeTenantId(body.tenant_id),
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
