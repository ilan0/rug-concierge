import { NextRequest, NextResponse, after } from "next/server";
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
import { isStaffUnlockedFromRequest } from "@/lib/auth/staff";
import { requestVisionEnrichment } from "@/lib/inventory/vision-enrichment";
import {
  checkLocalRateLimit,
  checkRateLimit,
  inventoryWriteRateLimit,
} from "@/lib/rate-limit";

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

function parseStockIdField(value: FormDataEntryValue | null): {
  ok: true;
  value: string | null;
} | {
  ok: false;
  error: string;
} {
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

async function applyFallbackLabel(input: { tenantId: string; rugId: string }) {
  await supabaseAdmin
    .from("rugs")
    .update({
      intake_label: `Rug ${input.rugId.slice(0, 6)}`,
      ai_description: null,
      ai_structured_fields: null,
    })
    .eq("tenant_id", input.tenantId)
    .eq("id", input.rugId);
}

async function runVisionEnrichment(input: {
  tenantId: string;
  rugId: string;
  imageUrl: string;
  widthTotalIn: number;
  lengthTotalIn: number;
}) {
  const enrichment = await requestVisionEnrichment({
    imageUrl: input.imageUrl,
    widthTotalIn: input.widthTotalIn,
    lengthTotalIn: input.lengthTotalIn,
  });

  if (!enrichment) {
    await applyFallbackLabel({ tenantId: input.tenantId, rugId: input.rugId });
    return;
  }

  const result = await supabaseAdmin
    .from("rugs")
    .update({
      intake_label: enrichment.intakeLabel,
      ai_description: enrichment.aiDescription,
      ai_structured_fields: enrichment.aiStructuredFields,
    })
    .eq("tenant_id", input.tenantId)
    .eq("id", input.rugId);

  if (result.error) {
    await applyFallbackLabel({ tenantId: input.tenantId, rugId: input.rugId });
  }
}

function scheduleBackgroundTask(task: () => Promise<void>) {
  try {
    after(async () => {
      await task();
    });
  } catch {
    void task().catch((error) => {
      console.error("[intake] background task failed", error);
    });
  }
}

export async function POST(req: NextRequest) {
  if (!isStaffUnlockedFromRequest(req)) {
    return NextResponse.json({ error: "staff_locked" }, { status: 401 });
  }

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";
  const rateLimitResult = inventoryWriteRateLimit
    ? await checkRateLimit(inventoryWriteRateLimit, `inventory:intake:${ip}`)
    : checkLocalRateLimit({
        key: `inventory:intake:${ip}`,
        maxRequests: 30,
        windowMs: 10 * 60 * 1000,
      });
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

  const rugId = crypto.randomUUID();

  const insertedRug = await supabaseAdmin
    .from("rugs")
    .insert({
      id: rugId,
      tenant_id: tenantId,
      status: "available",
      stock_id: parsed.value.stockId,
      intake_label: null,
      ai_description: null,
      ai_structured_fields: null,
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
  const imageBuffer = Buffer.from(await parsed.value.image.arrayBuffer());

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
    })
    .select("rug_id")
    .single();

  if (imageInsert.error || !imageInsert.data) {
    await cleanupFailedWrite({
      tenantId,
      rugId,
      storagePath,
    });
    return internalError("Unable to finalize intake image metadata.");
  }

  const primaryImageUrl = rugImagePathToPublicUrl(supabaseAdmin, storagePath);

  if (primaryImageUrl) {
    scheduleBackgroundTask(async () => {
      try {
        await runVisionEnrichment({
          tenantId,
          rugId,
          imageUrl: primaryImageUrl,
          widthTotalIn: parsed.value.widthTotalIn,
          lengthTotalIn: parsed.value.lengthTotalIn,
        });
      } catch (error) {
        console.error("[intake] vision enrichment failed", {
          tenant_id: tenantId,
          rug_id: rugId,
          error,
        });
      }
    });
  } else {
    scheduleBackgroundTask(async () => {
      await applyFallbackLabel({ tenantId, rugId });
    });
  }

  return NextResponse.json({
    rug: {
      id: rugId,
      intake_label: null,
      ai_description: null,
      stock_id: parsed.value.stockId,
      width_total_in: parsed.value.widthTotalIn,
      length_total_in: parsed.value.lengthTotalIn,
      status: "available",
      primary_image_url: primaryImageUrl,
    },
    ai_status: "processing",
  });
}
