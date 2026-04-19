import {
  createHmac,
  timingSafeEqual,
} from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getTenantRuntimeSecretsById } from "@/lib/tenant-secrets";
import { hashBytesSha256 } from "@/lib/inventory/image-hash";
import { fetchRugRecordById } from "@/lib/inventory/rug-record";
import {
  deriveRugLabelForDuplicate,
  enqueueInventoryEnrichmentJob,
} from "@/lib/inventory/enrichment-jobs";
import { rugImagePathToPublicUrl } from "@/lib/storage/rug-images";
import type { IntakeCreateResponse } from "@/lib/types/intake";

export const RUG_IMAGES_BUCKET = "rug-images";
export const INTAKE_UPLOAD_SESSION_TTL_MS = 10 * 60 * 1000;

const MIME_EXTENSION_MAP: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/avif": "avif",
};

type FinalizeTokenClaims = {
  v: 1;
  tenant_id: string;
  storage_path: string;
  stock_id: string | null;
  width_ft: number;
  width_in: number;
  length_ft: number;
  length_in: number;
  file_bytes: number;
  file_mime_type: string;
  exp: number;
};

type FinalizeTokenPayload = {
  stockId: string | null;
  widthFt: number;
  widthIn: number;
  lengthFt: number;
  lengthIn: number;
  fileBytes: number;
  fileMimeType: string;
};

export type CreateFinalizeTokenInput = {
  tenantId: string;
  storagePath: string;
  payload: FinalizeTokenPayload;
  expiresAtMs?: number;
};

export type CreateFinalizeTokenResult =
  | { ok: true; token: string; expiresAtMs: number }
  | { ok: false; message: string };

export type VerifyFinalizeTokenResult =
  | {
      ok: true;
      claims: {
        stockId: string | null;
        widthFt: number;
        widthIn: number;
        lengthFt: number;
        lengthIn: number;
        widthTotalIn: number;
        lengthTotalIn: number;
      };
    }
  | { ok: false; message: string };

export type FinalizeIntakeFromStorageInput = {
  tenantId: string;
  storagePath: string;
  claims: {
    stockId: string | null;
    widthFt: number;
    widthIn: number;
    lengthFt: number;
    lengthIn: number;
    widthTotalIn: number;
    lengthTotalIn: number;
  };
};

export type FinalizeIntakeFromStorageResult =
  | { kind: "created"; value: IntakeCreateResponse }
  | {
      kind: "duplicate";
      existing: {
        id: string;
        label: string | null;
      };
    }
  | {
      kind: "error";
      status: 400 | 500;
      message: string;
    };

function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value: string): string | null {
  try {
    return Buffer.from(value, "base64url").toString("utf8");
  } catch {
    return null;
  }
}

function signTokenPayload(payloadSegment: string, secret: string): string {
  return createHmac("sha256", secret).update(payloadSegment).digest("base64url");
}

function timingSafeSignatureMatch(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function toTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isWholeNumberInRange(
  value: unknown,
  min: number,
  max: number
): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= min &&
    value <= max
  );
}

function parseClaims(raw: unknown): FinalizeTokenClaims | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  if (row.v !== 1) return null;

  const tenantId = toTrimmedString(row.tenant_id);
  const storagePath = toTrimmedString(row.storage_path);
  const stockIdRaw = row.stock_id;
  const fileMimeType = toTrimmedString(row.file_mime_type);

  if (!tenantId || !storagePath || !fileMimeType) return null;
  if (!isWholeNumberInRange(row.width_ft, 0, 99)) return null;
  if (!isWholeNumberInRange(row.width_in, 0, 11)) return null;
  if (!isWholeNumberInRange(row.length_ft, 0, 99)) return null;
  if (!isWholeNumberInRange(row.length_in, 0, 11)) return null;
  if (!isWholeNumberInRange(row.file_bytes, 1, 100 * 1024 * 1024)) return null;
  if (!isWholeNumberInRange(row.exp, 1, 99_999_999_999)) return null;

  return {
    v: 1,
    tenant_id: tenantId,
    storage_path: storagePath,
    stock_id: typeof stockIdRaw === "string" ? stockIdRaw : null,
    width_ft: row.width_ft,
    width_in: row.width_in,
    length_ft: row.length_ft,
    length_in: row.length_in,
    file_bytes: row.file_bytes,
    file_mime_type: fileMimeType,
    exp: row.exp,
  };
}

function normalizeStoragePath(path: string): string {
  return path.trim().replace(/^\/+/, "").replace(/\/+/g, "/");
}

function ensureTenantScopedPath(tenantId: string, storagePath: string): boolean {
  const normalizedTenantId = tenantId.trim();
  const normalizedPath = normalizeStoragePath(storagePath);
  return normalizedPath.startsWith(`${normalizedTenantId}/`);
}

export function extensionForUpload(input: {
  filename: string | null;
  mimeType: string;
}): string {
  const byMime = MIME_EXTENSION_MAP[input.mimeType.toLowerCase()];
  if (byMime) return byMime;

  const filename = input.filename ?? "";
  const byName = filename.split(".").pop()?.trim().toLowerCase() ?? "";
  if (byName && /^[a-z0-9]{2,6}$/.test(byName)) return byName;
  return "jpg";
}

export function buildStoragePathForDirectUpload(input: {
  tenantId: string;
  filename: string | null;
  mimeType: string;
}): string {
  const extension = extensionForUpload({
    filename: input.filename,
    mimeType: input.mimeType,
  });
  return `${input.tenantId}/${crypto.randomUUID()}/primary-${Date.now()}.${extension}`;
}

async function getTenantIntakeSigningSecret(
  tenantId: string
): Promise<{ ok: true; secret: string } | { ok: false; message: string }> {
  const secretsResult = await getTenantRuntimeSecretsById(tenantId);
  if (!secretsResult.ok) {
    return { ok: false, message: secretsResult.message };
  }
  const cookieSecret = secretsResult.secrets.cookieSecret;
  if (!cookieSecret) {
    return {
      ok: false,
      message: `Cookie secret is not configured for tenant "${tenantId}".`,
    };
  }
  return { ok: true, secret: cookieSecret };
}

export async function createIntakeFinalizeToken(
  input: CreateFinalizeTokenInput
): Promise<CreateFinalizeTokenResult> {
  const secretResult = await getTenantIntakeSigningSecret(input.tenantId);
  if (!secretResult.ok) {
    return secretResult;
  }

  const expiresAtMs = input.expiresAtMs ?? Date.now() + INTAKE_UPLOAD_SESSION_TTL_MS;
  const claims: FinalizeTokenClaims = {
    v: 1,
    tenant_id: input.tenantId,
    storage_path: normalizeStoragePath(input.storagePath),
    stock_id: input.payload.stockId,
    width_ft: input.payload.widthFt,
    width_in: input.payload.widthIn,
    length_ft: input.payload.lengthFt,
    length_in: input.payload.lengthIn,
    file_bytes: input.payload.fileBytes,
    file_mime_type: input.payload.fileMimeType,
    exp: Math.floor(expiresAtMs / 1000),
  };

  const payloadSegment = base64UrlEncode(JSON.stringify(claims));
  const signatureSegment = signTokenPayload(payloadSegment, secretResult.secret);
  return {
    ok: true,
    token: `${payloadSegment}.${signatureSegment}`,
    expiresAtMs,
  };
}

export async function verifyIntakeFinalizeToken(input: {
  tenantId: string;
  storagePath: string;
  token: string;
}): Promise<VerifyFinalizeTokenResult> {
  const secretResult = await getTenantIntakeSigningSecret(input.tenantId);
  if (!secretResult.ok) {
    return { ok: false, message: secretResult.message };
  }

  const [payloadSegment, signatureSegment] = input.token.split(".");
  if (!payloadSegment || !signatureSegment) {
    return { ok: false, message: "Invalid finalize token." };
  }

  const expectedSignature = signTokenPayload(payloadSegment, secretResult.secret);
  if (!timingSafeSignatureMatch(signatureSegment, expectedSignature)) {
    return { ok: false, message: "Invalid finalize token signature." };
  }

  const decodedPayload = base64UrlDecode(payloadSegment);
  if (!decodedPayload) {
    return { ok: false, message: "Invalid finalize token payload." };
  }

  let rawClaims: unknown;
  try {
    rawClaims = JSON.parse(decodedPayload) as unknown;
  } catch {
    return { ok: false, message: "Invalid finalize token payload." };
  }

  const parsedClaims = parseClaims(rawClaims);
  if (!parsedClaims) {
    return { ok: false, message: "Invalid finalize token claims." };
  }

  if (parsedClaims.exp < Math.floor(Date.now() / 1000)) {
    return { ok: false, message: "Finalize token has expired." };
  }
  if (parsedClaims.tenant_id !== input.tenantId) {
    return { ok: false, message: "Finalize token tenant mismatch." };
  }

  const normalizedStoragePath = normalizeStoragePath(input.storagePath);
  if (parsedClaims.storage_path !== normalizedStoragePath) {
    return { ok: false, message: "Finalize token path mismatch." };
  }
  if (!ensureTenantScopedPath(input.tenantId, normalizedStoragePath)) {
    return { ok: false, message: "storage_path must remain tenant-scoped." };
  }

  const widthTotalIn = parsedClaims.width_ft * 12 + parsedClaims.width_in;
  const lengthTotalIn = parsedClaims.length_ft * 12 + parsedClaims.length_in;
  if (widthTotalIn <= 0 || lengthTotalIn <= 0) {
    return { ok: false, message: "Invalid dimensions in finalize token." };
  }

  return {
    ok: true,
    claims: {
      stockId: parsedClaims.stock_id,
      widthFt: parsedClaims.width_ft,
      widthIn: parsedClaims.width_in,
      lengthFt: parsedClaims.length_ft,
      lengthIn: parsedClaims.length_in,
      widthTotalIn,
      lengthTotalIn,
    },
  };
}

async function cleanupFailedFinalize(input: {
  tenantId: string;
  rugId?: string;
  storagePath?: string;
}) {
  if (input.storagePath) {
    try {
      await supabaseAdmin.storage.from(RUG_IMAGES_BUCKET).remove([input.storagePath]);
    } catch {
      // Best effort cleanup.
    }
  }

  if (input.rugId) {
    try {
      await supabaseAdmin
        .from("rugs")
        .delete()
        .eq("tenant_id", input.tenantId)
        .eq("id", input.rugId);
    } catch {
      // Best effort cleanup.
    }
  }
}

async function findExistingRugByImageHash(input: {
  tenantId: string;
  imageSha256: string;
}): Promise<{ id: string; label: string | null; path: string | null } | null> {
  const result = await supabaseAdmin
    .from("rug_images")
    .select("rug_id, path")
    .eq("tenant_id", input.tenantId)
    .eq("image_sha256", input.imageSha256)
    .limit(1)
    .maybeSingle();

  if (result.error) {
    return null;
  }

  const rugId =
    result.data && typeof result.data.rug_id === "string" ? result.data.rug_id : null;
  if (!rugId) return null;
  const imagePath =
    result.data && typeof result.data.path === "string" ? result.data.path : null;

  const rug = await fetchRugRecordById({
    supabase: supabaseAdmin,
    tenantId: input.tenantId,
    id: rugId,
  });
  return {
    id: rugId,
    label: deriveRugLabelForDuplicate(rug),
    path: imagePath,
  };
}

function isUniqueConstraintError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const typed = error as Record<string, unknown>;
  const code = typeof typed.code === "string" ? typed.code : "";
  const message = typeof typed.message === "string" ? typed.message : "";
  return code === "23505" || message.includes("duplicate key value");
}

async function downloadStorageBytes(input: {
  storagePath: string;
}): Promise<{ ok: true; bytes: Buffer } | { ok: false; message: string }> {
  const download = await supabaseAdmin.storage
    .from(RUG_IMAGES_BUCKET)
    .download(input.storagePath);

  if (download.error || !download.data) {
    return { ok: false, message: "Uploaded image object was not found." };
  }

  const arrayBuffer = await download.data.arrayBuffer();
  const bytes = Buffer.from(arrayBuffer);
  if (bytes.length === 0) {
    return { ok: false, message: "Uploaded image object is empty." };
  }
  return { ok: true, bytes };
}

export async function finalizeIntakeFromStorage(
  input: FinalizeIntakeFromStorageInput
): Promise<FinalizeIntakeFromStorageResult> {
  if (!ensureTenantScopedPath(input.tenantId, input.storagePath)) {
    return {
      kind: "error",
      status: 400,
      message: "storage_path must remain tenant-scoped.",
    };
  }

  const objectBytes = await downloadStorageBytes({ storagePath: input.storagePath });
  if (!objectBytes.ok) {
    return {
      kind: "error",
      status: 400,
      message: objectBytes.message,
    };
  }

  const imageSha256 = hashBytesSha256(objectBytes.bytes);
  const existingDuplicate = await findExistingRugByImageHash({
    tenantId: input.tenantId,
    imageSha256,
  });
  if (existingDuplicate) {
    const duplicatePath = existingDuplicate.path
      ? normalizeStoragePath(existingDuplicate.path)
      : null;
    const incomingPath = normalizeStoragePath(input.storagePath);
    if (duplicatePath !== incomingPath) {
      await cleanupFailedFinalize({
        tenantId: input.tenantId,
        storagePath: input.storagePath,
      });
    }
    return { kind: "duplicate", existing: existingDuplicate };
  }

  const rugId = crypto.randomUUID();
  const normalizedStockId =
    input.claims.stockId ?? `AUTO-${rugId.slice(0, 8).toUpperCase()}`;

  const rugInsert = await supabaseAdmin
    .from("rugs")
    .insert({
      id: rugId,
      tenant_id: input.tenantId,
      status: "not_available",
      stock_id: normalizedStockId,
      intake_label: null,
      ai_description: null,
      ai_structured_fields: null,
      enrichment_status: "processing",
      review_reason_code: null,
      width_ft: input.claims.widthFt,
      width_in: input.claims.widthIn,
      length_ft: input.claims.lengthFt,
      length_in: input.claims.lengthIn,
    })
    .select("id")
    .single();

  if (rugInsert.error || !rugInsert.data) {
    await cleanupFailedFinalize({
      tenantId: input.tenantId,
      storagePath: input.storagePath,
    });
    return { kind: "error", status: 500, message: "Unable to create intake record." };
  }

  const imageInsert = await supabaseAdmin
    .from("rug_images")
    .insert({
      tenant_id: input.tenantId,
      rug_id: rugId,
      path: input.storagePath,
      original_path: input.storagePath,
      image_sha256: imageSha256,
      enhancement_status: "not_started",
      enhancement_model: null,
      enhanced_at: null,
      enhancement_error: null,
    })
    .select("rug_id")
    .single();

  if (imageInsert.error || !imageInsert.data) {
    const duplicateAfterInsert = isUniqueConstraintError(imageInsert.error)
      ? await findExistingRugByImageHash({
          tenantId: input.tenantId,
          imageSha256,
        })
      : null;

    await cleanupFailedFinalize({
      tenantId: input.tenantId,
      rugId,
      storagePath: input.storagePath,
    });

    if (duplicateAfterInsert) {
      return {
        kind: "duplicate",
        existing: duplicateAfterInsert,
      };
    }

    return {
      kind: "error",
      status: 500,
      message: "Unable to finalize intake image metadata.",
    };
  }

  const enqueueResult = await enqueueInventoryEnrichmentJob({
    tenantId: input.tenantId,
    rugId,
    restoreAvailableOnReady: true,
  });
  if (!enqueueResult.ok) {
    await cleanupFailedFinalize({
      tenantId: input.tenantId,
      rugId,
      storagePath: input.storagePath,
    });
    return {
      kind: "error",
      status: 500,
      message: "Unable to queue AI enrichment job.",
    };
  }

  return {
    kind: "created",
    value: {
      rug: {
        id: rugId,
        intake_label: null,
        ai_description: null,
        stock_id: normalizedStockId,
        width_total_in: input.claims.widthTotalIn,
        length_total_in: input.claims.lengthTotalIn,
        status: "not_available",
        enrichment_status: "processing",
        review_reason_code: null,
        primary_image_url: rugImagePathToPublicUrl(supabaseAdmin, input.storagePath),
      },
      ai_status: "processing",
    },
  };
}
