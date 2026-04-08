import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { badRequest, internalError } from "@/lib/errors/http-errors";
import { resolveTenantFromRequest } from "@/lib/tenant/resolve-tenant";
import { getStaffUnlockStateFromRequest } from "@/lib/auth/staff";
import {
  checkRateLimit,
  inventoryWriteRateLimit,
} from "@/lib/rate-limit";
import {
  parseDimensionField,
  validateDimensionTuple,
  validateImageUploadMetadata,
} from "@/lib/intake/validation";
import {
  buildStoragePathForDirectUpload,
  createIntakeFinalizeToken,
  RUG_IMAGES_BUCKET,
} from "@/lib/intake/direct-upload";
import type {
  IntakeUploadSessionRequest,
  IntakeUploadSessionResponse,
} from "@/lib/types/intake";

export const runtime = "nodejs";

function parseStockIdField(
  value: unknown
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value === null || value === undefined) {
    return { ok: true, value: null };
  }
  if (typeof value !== "string") {
    return { ok: false, error: "stock_id must be a string when provided." };
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return { ok: true, value: null };
  }
  if (trimmed.length > 80) {
    return { ok: false, error: "stock_id must be 80 characters or fewer." };
  }

  return { ok: true, value: trimmed };
}

function parseJsonPayload(value: unknown):
  | {
      ok: true;
      value: IntakeUploadSessionRequest;
    }
  | { ok: false; response: NextResponse } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      ok: false,
      response: badRequest("Invalid JSON body."),
    };
  }

  const typed = value as Record<string, unknown>;
  const fileValue =
    typed.file && typeof typed.file === "object" && !Array.isArray(typed.file)
      ? (typed.file as Record<string, unknown>)
      : null;
  if (!fileValue) {
    return {
      ok: false,
      response: badRequest("file metadata is required."),
    };
  }

  const parsedDimensions = validateDimensionTuple({
    widthFt: parseDimensionField(String(typed.width_ft ?? ""), "width_ft"),
    widthIn: parseDimensionField(String(typed.width_in ?? ""), "width_in"),
    lengthFt: parseDimensionField(String(typed.length_ft ?? ""), "length_ft"),
    lengthIn: parseDimensionField(String(typed.length_in ?? ""), "length_in"),
  });
  if (!parsedDimensions.ok) {
    return { ok: false, response: badRequest(parsedDimensions.error) };
  }

  const parsedStockId = parseStockIdField(typed.stock_id);
  if (!parsedStockId.ok) {
    return { ok: false, response: badRequest(parsedStockId.error) };
  }

  const parsedMetadata = validateImageUploadMetadata({
    mimeType: fileValue.mime_type,
    bytes: fileValue.bytes,
  });
  if (!parsedMetadata.ok) {
    return { ok: false, response: badRequest(parsedMetadata.error) };
  }

  const filename =
    typeof fileValue.filename === "string" ? fileValue.filename.trim() : "";
  if (!filename) {
    return {
      ok: false,
      response: badRequest("file.filename is required."),
    };
  }

  return {
    ok: true,
    value: {
      stock_id: parsedStockId.value,
      width_ft: parsedDimensions.value.widthFt,
      width_in: parsedDimensions.value.widthIn,
      length_ft: parsedDimensions.value.lengthFt,
      length_in: parsedDimensions.value.lengthIn,
      file: {
        filename,
        mime_type: parsedMetadata.mimeType,
        bytes: parsedMetadata.bytes,
      },
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
    `inventory:intake:upload-session:${ip}`
  );
  if (!rateLimitResult.allowed) {
    return NextResponse.json(
      { error: "Too many intake requests. Please wait and try again." },
      { status: 429 }
    );
  }

  const payload = await req.json().catch(() => null);
  const parsed = parseJsonPayload(payload);
  if (!parsed.ok) {
    return parsed.response;
  }

  const storagePath = buildStoragePathForDirectUpload({
    tenantId,
    filename: parsed.value.file.filename,
    mimeType: parsed.value.file.mime_type,
  });

  const signedUpload = await supabaseAdmin.storage
    .from(RUG_IMAGES_BUCKET)
    .createSignedUploadUrl(storagePath, { upsert: false });
  if (signedUpload.error || !signedUpload.data?.signedUrl) {
    return internalError("Unable to create signed upload URL.");
  }

  const finalizeToken = await createIntakeFinalizeToken({
    tenantId,
    storagePath,
    payload: {
      stockId: parsed.value.stock_id ?? null,
      widthFt: parsed.value.width_ft,
      widthIn: parsed.value.width_in,
      lengthFt: parsed.value.length_ft,
      lengthIn: parsed.value.length_in,
      fileBytes: parsed.value.file.bytes,
      fileMimeType: parsed.value.file.mime_type,
    },
  });
  if (!finalizeToken.ok) {
    return NextResponse.json({ error: finalizeToken.message }, { status: 503 });
  }

  const response: IntakeUploadSessionResponse = {
    upload_url: signedUpload.data.signedUrl,
    storage_path: storagePath,
    finalize_token: finalizeToken.token,
    expires_at: new Date(finalizeToken.expiresAtMs).toISOString(),
  };

  return NextResponse.json(response);
}
