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

const RUG_IMAGES_BUCKET = "rug-images";
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const VISION_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["intake_label", "ai_description"],
  properties: {
    intake_label: { type: "string", minLength: 1, maxLength: 120 },
    ai_description: { type: "string", minLength: 1, maxLength: 1200 },
  },
} as const;

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

function parseMultipartForm(formData: FormData):
  | {
      ok: true;
      value: {
        tenantId: string | null;
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

  return {
    ok: true,
    value: {
      tenantId: normalizeTenantId(formData.get("tenant_id")),
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

function extractOutputText(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const data = payload as Record<string, unknown>;

  if (typeof data.output_text === "string" && data.output_text.trim()) {
    return data.output_text;
  }

  if (!Array.isArray(data.output)) return null;

  for (const outputItem of data.output) {
    if (!outputItem || typeof outputItem !== "object") continue;
    const item = outputItem as Record<string, unknown>;
    if (!Array.isArray(item.content)) continue;

    for (const part of item.content) {
      if (!part || typeof part !== "object") continue;
      const block = part as Record<string, unknown>;
      if (typeof block.text === "string" && block.text.trim()) {
        return block.text;
      }
    }
  }

  return null;
}

function toPlainText(value: string): string {
  return value
    .replace(/\*\*/g, "")
    .replace(/[_`#]/g, "")
    .replace(/^\s*[-*•]+\s*/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseVisionJson(payload: unknown): {
  intakeLabel: string;
  aiDescription: string;
} | null {
  const normalizeParsed = (parsed: Record<string, unknown>) => {
    if (
      typeof parsed.intake_label !== "string" ||
      typeof parsed.ai_description !== "string"
    ) {
      return null;
    }
    const intakeLabel = toPlainText(parsed.intake_label).slice(0, 120);
    const aiDescription = toPlainText(parsed.ai_description);
    if (!intakeLabel || !aiDescription) return null;
    return { intakeLabel, aiDescription };
  };

  const outputText = extractOutputText(payload);
  if (outputText) {
    const cleaned = outputText
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();
    try {
      const parsed = JSON.parse(cleaned) as Record<string, unknown>;
      const normalized = normalizeParsed(parsed);
      if (normalized) return normalized;
    } catch {
      // Try direct JSON block parsing below.
    }
  }

  if (!payload || typeof payload !== "object") return null;
  const data = payload as Record<string, unknown>;
  if (!Array.isArray(data.output)) return null;

  for (const item of data.output) {
    if (!item || typeof item !== "object") continue;
    const outputItem = item as Record<string, unknown>;
    if (!Array.isArray(outputItem.content)) continue;
    for (const part of outputItem.content) {
      if (!part || typeof part !== "object") continue;
      const block = part as Record<string, unknown>;
      if (!block.json || typeof block.json !== "object") continue;
      const normalized = normalizeParsed(block.json as Record<string, unknown>);
      if (normalized) return normalized;
    }
  }

  return null;
}

async function runVisionEnrichment(input: {
  tenantId: string;
  rugId: string;
  imageUrl: string;
}) {
  const fallbackLabel = `Rug ${input.rugId.slice(0, 6)}`;
  const apiKey = process.env.OPENAI_API_KEY;

  const applyFallback = async () => {
    await supabaseAdmin
      .from("rugs")
      .update({ intake_label: fallbackLabel })
      .eq("tenant_id", input.tenantId)
      .eq("id", input.rugId);
  };

  if (!apiKey) {
    await applyFallback();
    return;
  }

  const requestPayload = {
    model: "gpt-4o",
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text:
              "You are an expert rug appraiser. Analyze the rug in this image and return a JSON object with exactly two fields: 'intake_label' (a concise 3-7 word staff label, e.g. 'Blue Persian Medallion 8x10') and 'ai_description' (a rich 2-4 sentence description covering: visible style tradition, color palette, pattern or motif, texture/material if discernible, and best room/aesthetic fit). Return only valid JSON, plain text descriptions, no markdown.",
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: "Analyze this rug photo.",
          },
          {
            type: "input_image",
            image_url: input.imageUrl,
          },
        ],
      },
    ],
    max_output_tokens: 500,
    text: {
      format: {
        type: "json_schema",
        name: "intake_vision_response",
        schema: VISION_OUTPUT_SCHEMA,
        strict: true,
      },
    },
  };

  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestPayload),
  }).catch(() => null);

  if (!response || !response.ok) {
    await applyFallback();
    return;
  }

  const payload = (await response.json().catch(() => null)) as unknown;
  const parsed = parseVisionJson(payload);

  if (!parsed) {
    await applyFallback();
    return;
  }

  await supabaseAdmin
    .from("rugs")
    .update({
      intake_label: parsed.intakeLabel,
      ai_description: parsed.aiDescription,
    })
    .eq("tenant_id", input.tenantId)
    .eq("id", input.rugId);
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
      intake_label: null,
      ai_description: null,
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
      is_primary: true,
      sort_order: 0,
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
      await supabaseAdmin
        .from("rugs")
        .update({ intake_label: `Rug ${rugId.slice(0, 6)}` })
        .eq("tenant_id", tenantId)
        .eq("id", rugId);
    });
  }

  return NextResponse.json({
    rug: {
      id: rugId,
      intake_label: null,
      ai_description: null,
      width_total_in: parsed.value.widthTotalIn,
      length_total_in: parsed.value.lengthTotalIn,
      status: "available",
      primary_image_url: primaryImageUrl,
    },
    ai_status: "processing",
  });
}
