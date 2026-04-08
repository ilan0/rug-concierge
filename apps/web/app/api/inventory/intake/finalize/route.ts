import { NextRequest, NextResponse } from "next/server";
import { badRequest } from "@/lib/errors/http-errors";
import { resolveTenantFromRequest } from "@/lib/tenant/resolve-tenant";
import { getStaffUnlockStateFromRequest } from "@/lib/auth/staff";
import {
  checkRateLimit,
  inventoryWriteRateLimit,
} from "@/lib/rate-limit";
import {
  finalizeIntakeFromStorage,
  verifyIntakeFinalizeToken,
} from "@/lib/intake/direct-upload";
import type {
  IntakeDuplicateImageResponse,
  IntakeFinalizeRequest,
} from "@/lib/types/intake";

export const runtime = "nodejs";

function parseFinalizePayload(value: unknown):
  | { ok: true; value: IntakeFinalizeRequest }
  | { ok: false; response: NextResponse } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, response: badRequest("Invalid JSON body.") };
  }

  const typed = value as Record<string, unknown>;
  const storagePath =
    typeof typed.storage_path === "string" ? typed.storage_path.trim() : "";
  if (!storagePath) {
    return {
      ok: false,
      response: badRequest("storage_path is required."),
    };
  }

  const finalizeToken =
    typeof typed.finalize_token === "string" ? typed.finalize_token.trim() : "";
  if (!finalizeToken) {
    return {
      ok: false,
      response: badRequest("finalize_token is required."),
    };
  }

  const clientSha256 =
    typeof typed.client_sha256 === "string" ? typed.client_sha256.trim() : null;

  return {
    ok: true,
    value: {
      storage_path: storagePath,
      finalize_token: finalizeToken,
      client_sha256: clientSha256,
    },
  };
}

export async function POST(req: NextRequest) {
  const tenantResolution = await resolveTenantFromRequest(req);
  if (!tenantResolution.ok) {
    return NextResponse.json(
      { error: tenantResolution.message },
      { status: tenantResolution.status }
    );
  }
  const tenantId = tenantResolution.tenantId;

  const staffUnlockState = await getStaffUnlockStateFromRequest(req, tenantId);
  if (!staffUnlockState.ok) {
    return NextResponse.json({ error: staffUnlockState.message }, { status: 503 });
  }
  if (!staffUnlockState.unlocked) {
    return NextResponse.json({ error: "staff_locked" }, { status: 401 });
  }

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";
  const rateLimitResult = await checkRateLimit(
    inventoryWriteRateLimit,
    `inventory:intake:finalize:${ip}`
  );
  if (!rateLimitResult.allowed) {
    return NextResponse.json(
      { error: "Too many intake requests. Please wait and try again." },
      { status: 429 }
    );
  }

  const payload = await req.json().catch(() => null);
  const parsed = parseFinalizePayload(payload);
  if (!parsed.ok) {
    return parsed.response;
  }

  const verifiedToken = await verifyIntakeFinalizeToken({
    tenantId,
    storagePath: parsed.value.storage_path,
    token: parsed.value.finalize_token,
  });
  if (!verifiedToken.ok) {
    return badRequest(verifiedToken.message);
  }

  const finalized = await finalizeIntakeFromStorage({
    tenantId,
    storagePath: parsed.value.storage_path,
    claims: verifiedToken.claims,
  });

  if (finalized.kind === "duplicate") {
    const response: IntakeDuplicateImageResponse = {
      error: "This photo matches a rug that already exists in inventory.",
      code: "DUPLICATE_IMAGE",
      existing_rug: {
        id: finalized.existing.id,
        label: finalized.existing.label,
      },
    };
    return NextResponse.json(response, { status: 409 });
  }

  if (finalized.kind === "error") {
    return NextResponse.json({ error: finalized.message }, { status: finalized.status });
  }

  return NextResponse.json(finalized.value);
}
