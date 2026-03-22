import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { rugImagePathToPublicUrl } from "@/lib/storage/rug-images";
import { badRequest, internalError } from "@/lib/errors/http-errors";
import {
  normalizeTenantId,
  resolveAuthoritativeTenantForServer,
} from "@/lib/auth/tenant";
import {
  parseDimensionField,
  validateDimensionTuple,
  validateImageFile,
} from "@/lib/intake/validation";
import { getStaffUnlockStateFromRequest } from "@/lib/auth/staff";
import {
  checkRateLimit,
  inventoryWriteRateLimit,
} from "@/lib/rate-limit";
import {
  deriveRugLabelForDuplicate,
  enqueueInventoryEnrichmentJob,
} from "@/lib/inventory/enrichment-jobs";
import { hashBytesSha256 } from "@/lib/inventory/image-hash";
import { fetchRugRecordById } from "@/lib/inventory/rug-record";

const RUG_IMAGES_BUCKET = "rug-images";

function extensionForImage(image: File): string {
  const type = image.type.toLowerCase();
  if (type === "image/jpeg" || type === "image/jpg") return "jpg";
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  if (type === "image/heic") return "heic";
  if (type === "image/heif") return "heif";
  if (type === "image/avif") return "avif";

  const byName = image.name
    .split(".")
    .pop()
    ?.trim()
    .toLowerCase();
  if (byName && /^[a-z0-9]{2,6}$/.test(byName)) return byName;
  return "jpg";
}

function buildStoragePath(tenantId: string, rugId: string, image: File): string {
  const ext = extensionForImage(image);
  return `${tenantId}/${rugId}/primary-${Date.now()}.${ext}`;
}

function parseStockIdField(value: FormDataEntryValue | null):
  | { ok: true; value: string | null }
  | { ok: false; error: string } {
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

function parseMultipartForm(formData: FormData):
  | {
      ok: true;
      value: {
        tenantId: string | null;
        stockId: string | null;
        widthFt: number;
        widthIn: number;
        lengthFt: number;
        lengthIn: number;
        widthTotalIn: number;
        lengthTotalIn: number;
        image: File;
      };
    }
  | { ok: false; response: NextResponse } {
  const dimensions = validateDimensionTuple({
    widthFt: parseDimensionField(formData.get("width_ft"), "width_ft"),
    widthIn: parseDimensionField(formData.get("width_in"), "width_in"),
    lengthFt: parseDimensionField(formData.get("length_ft"), "length_ft"),
    lengthIn: parseDimensionField(formData.get("length_in"), "length_in"),
  });

  if (!dimensions.ok) {
    return { ok: false, response: badRequest(dimensions.error) };
  }

  const imageResult = validateImageFile(formData.get("image"));
  if (!imageResult.ok) {
    return { ok: false, response: badRequest(imageResult.error) };
  }

  const stockIdResult = parseStockIdField(formData.get("stock_id"));
  if (!stockIdResult.ok) {
    return { ok: false, response: badRequest(stockIdResult.error) };
  }

  return {
    ok: true,
    value: {
      tenantId: normalizeTenantId(formData.get("tenant_id")),
      stockId: stockIdResult.value,
      widthFt: dimensions.value.widthFt,
      widthIn: dimensions.value.widthIn,
      lengthFt: dimensions.value.lengthFt,
      lengthIn: dimensions.value.lengthIn,
      widthTotalIn: dimensions.value.widthTotalIn,
      lengthTotalIn: dimensions.value.lengthTotalIn,
      image: imageResult.file,
    },
  };
}

async function cleanupFailedWrite(input: {
  tenantId: string;
  rugId: string;
  storagePath?: string;
}) {
  if (input.storagePath) {
    try {
      await supabaseAdmin.storage.from(RUG_IMAGES_BUCKET).remove([input.storagePath]);
    } catch {
      // Best effort cleanup.
    }
  }

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

async function findExistingRugByImageHash(input: {
  tenantId: string;
  imageSha256: string;
}): Promise<{ id: string; label: string | null } | null> {
  const result = await supabaseAdmin
    .from("rug_images")
    .select("rug_id")
    .eq("tenant_id", input.tenantId)
    .eq("image_sha256", input.imageSha256)
    .limit(1)
    .maybeSingle();

  if (result.error) {
    return null;
  }

  const rugId =
    result.data && typeof result.data.rug_id === "string"
      ? result.data.rug_id
      : null;
  if (!rugId) return null;

  const rug = await fetchRugRecordById({
    supabase: supabaseAdmin,
    tenantId: input.tenantId,
    id: rugId,
  });

  return {
    id: rugId,
    label: deriveRugLabelForDuplicate(rug),
  };
}

function duplicateImageResponse(input: { id: string; label: string | null }) {
  return NextResponse.json(
    {
      error: "This photo matches a rug that already exists in inventory.",
      code: "DUPLICATE_IMAGE",
      existing_rug: {
        id: input.id,
        label: input.label,
      },
    },
    { status: 409 }
  );
}

export async function POST(req: NextRequest) {
  const staffUnlockState = await getStaffUnlockStateFromRequest(req);
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
    `inventory:intake:${ip}`
  );
  if (!rateLimitResult.allowed) {
    return NextResponse.json(
      { error: "Too many intake requests. Please wait and try again." },
      { status: 429 }
    );
  }

  const formData = await req.formData().catch(() => null);
  if (!(formData instanceof FormData)) {
    return badRequest("Invalid multipart form payload.");
  }

  const parsed = parseMultipartForm(formData);
  if (!parsed.ok) {
    return parsed.response;
  }

  const tenantId = resolveAuthoritativeTenantForServer({
    requestTenantId: parsed.value.tenantId,
  });
  if (!tenantId) {
    return badRequest("tenant_id is required.");
  }

  const imageBuffer = Buffer.from(await parsed.value.image.arrayBuffer());
  const imageSha256 = hashBytesSha256(imageBuffer);

  const existingDuplicate = await findExistingRugByImageHash({
    tenantId,
    imageSha256,
  });
  if (existingDuplicate) {
    return duplicateImageResponse(existingDuplicate);
  }

  const rugId = crypto.randomUUID();
  const normalizedStockId =
    parsed.value.stockId ?? `AUTO-${rugId.slice(0, 8).toUpperCase()}`;

  const insertedRug = await supabaseAdmin
    .from("rugs")
    .insert({
      id: rugId,
      tenant_id: tenantId,
      status: "available",
      stock_id: normalizedStockId,
      intake_label: null,
      ai_description: null,
      ai_structured_fields: null,
      enrichment_status: "processing",
      review_reason_code: null,
      width_ft: parsed.value.widthFt,
      width_in: parsed.value.widthIn,
      length_ft: parsed.value.lengthFt,
      length_in: parsed.value.lengthIn,
    })
    .select("id")
    .single();

  if (insertedRug.error || !insertedRug.data) {
    return internalError("Unable to create intake record.");
  }

  const storagePath = buildStoragePath(tenantId, rugId, parsed.value.image);
  const upload = await supabaseAdmin.storage
    .from(RUG_IMAGES_BUCKET)
    .upload(storagePath, imageBuffer, {
      contentType: parsed.value.image.type || "application/octet-stream",
      upsert: false,
    });

  if (upload.error) {
    await cleanupFailedWrite({ tenantId, rugId });
    return internalError("Unable to upload intake image.");
  }

  const imageInsert = await supabaseAdmin
    .from("rug_images")
    .insert({
      tenant_id: tenantId,
      rug_id: rugId,
      path: storagePath,
      image_sha256: imageSha256,
    })
    .select("rug_id")
    .single();

  if (imageInsert.error || !imageInsert.data) {
    const duplicateAfterInsert = await findExistingRugByImageHash({
      tenantId,
      imageSha256,
    });

    await cleanupFailedWrite({
      tenantId,
      rugId,
      storagePath,
    });

    if (duplicateAfterInsert) {
      return duplicateImageResponse(duplicateAfterInsert);
    }
    return internalError("Unable to finalize intake image metadata.");
  }

  const enqueueResult = await enqueueInventoryEnrichmentJob({
    tenantId,
    rugId,
  });
  if (!enqueueResult.ok) {
    await cleanupFailedWrite({
      tenantId,
      rugId,
      storagePath,
    });
    return internalError("Unable to queue AI enrichment job.");
  }

  const primaryImageUrl = rugImagePathToPublicUrl(supabaseAdmin, storagePath);

  return NextResponse.json({
    rug: {
      id: rugId,
      intake_label: null,
      ai_description: null,
      stock_id: normalizedStockId,
      width_total_in: parsed.value.widthTotalIn,
      length_total_in: parsed.value.lengthTotalIn,
      status: "available",
      enrichment_status: "processing",
      review_reason_code: null,
      primary_image_url: primaryImageUrl,
    },
    ai_status: "processing",
  });
}
