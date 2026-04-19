import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  GEMINI_API_KEY,
  GEMINI_IMAGE_ENHANCEMENT_MODEL,
} from "@/lib/config";

const RUG_IMAGES_BUCKET = "rug-images";
const GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

export const RUG_IMAGE_ENHANCEMENT_PROMPT_VERSION = "gemini-oak-floor-v1";

type RugImageEnhancementStatus =
  | "not_started"
  | "processing"
  | "ready"
  | "failed";

type RugImageRow = {
  id: string;
  tenant_id: string;
  rug_id: string;
  path: string | null;
  original_path: string | null;
  enhancement_status: RugImageEnhancementStatus;
  enhancement_model: string | null;
  enhanced_at: string | null;
  enhancement_error: string | null;
};

export type EnhanceRugPrimaryImageResult = {
  displayPath: string;
  originalPath: string;
  model: string;
};

function normalizeStoragePath(path: string | null | undefined): string | null {
  if (typeof path !== "string") return null;
  const normalized = path.trim().replace(/^\/+/, "").replace(/\/+/g, "/");
  return normalized.length > 0 ? normalized : null;
}

function sanitizeForPathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
}

function inferMimeTypeFromPath(path: string | null): string {
  const normalized = normalizeStoragePath(path);
  const extension = normalized?.split(".").pop()?.toLowerCase() ?? "";
  switch (extension) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "heic":
      return "image/heic";
    case "heif":
      return "image/heif";
    case "avif":
      return "image/avif";
    default:
      return "image/jpeg";
  }
}

function extensionForMimeType(mimeType: string | null | undefined): string {
  const normalized = (mimeType ?? "").trim().toLowerCase();
  switch (normalized) {
    case "image/jpeg":
    case "image/jpg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/heic":
      return "heic";
    case "image/heif":
      return "heif";
    case "image/avif":
      return "avif";
    default:
      return "png";
  }
}

function truncateErrorMessage(message: string): string {
  const trimmed = message.trim();
  if (trimmed.length <= 500) return trimmed;
  return `${trimmed.slice(0, 497)}...`;
}

function isLikelyMissingColumnError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("does not exist") ||
    normalized.includes("schema cache") ||
    normalized.includes("could not find the")
  );
}

function toStringOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toEnhancementStatus(
  value: unknown
): RugImageEnhancementStatus {
  if (value === "processing") return "processing";
  if (value === "ready") return "ready";
  if (value === "failed") return "failed";
  return "not_started";
}

function parseRugImageRow(value: unknown): RugImageRow | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const id = toStringOrNull(row.id);
  const tenantId = toStringOrNull(row.tenant_id);
  const rugId = toStringOrNull(row.rug_id);
  if (!id || !tenantId || !rugId) return null;

  return {
    id,
    tenant_id: tenantId,
    rug_id: rugId,
    path: toStringOrNull(row.path),
    original_path: toStringOrNull(row.original_path),
    enhancement_status: toEnhancementStatus(row.enhancement_status),
    enhancement_model: toStringOrNull(row.enhancement_model),
    enhanced_at: toStringOrNull(row.enhanced_at),
    enhancement_error: toStringOrNull(row.enhancement_error),
  };
}

async function fetchRugImageRow(input: {
  supabase: SupabaseClient;
  tenantId: string;
  rugId: string;
}): Promise<RugImageRow | null> {
  const runQuery = (columns: string) =>
    input.supabase
      .from("rug_images")
      .select(columns)
      .eq("tenant_id", input.tenantId)
      .eq("rug_id", input.rugId)
      .maybeSingle();

  let result = await runQuery(
    "id, tenant_id, rug_id, path, original_path, enhancement_status, enhancement_model, enhanced_at, enhancement_error"
  );
  if (result.error && isLikelyMissingColumnError(result.error.message ?? "")) {
    result = await runQuery("id, tenant_id, rug_id, path");
  }

  if (result.error || !result.data) return null;
  return parseRugImageRow(result.data);
}

async function updateRugImageRow(input: {
  supabase: SupabaseClient;
  tenantId: string;
  rugId: string;
  payload: Record<string, unknown>;
}): Promise<void> {
  const result = await input.supabase
    .from("rug_images")
    .update(input.payload)
    .eq("tenant_id", input.tenantId)
    .eq("rug_id", input.rugId);

  if (result.error) {
    throw new Error(result.error.message ?? "Unable to update rug image state.");
  }
}

async function downloadStorageObject(input: {
  supabase: SupabaseClient;
  path: string;
}): Promise<{ bytes: Buffer; mimeType: string }> {
  const download = await input.supabase.storage
    .from(RUG_IMAGES_BUCKET)
    .download(input.path);

  if (download.error || !download.data) {
    throw new Error(download.error?.message ?? "Unable to download rug image.");
  }

  const bytes = Buffer.from(await download.data.arrayBuffer());
  if (bytes.length === 0) {
    throw new Error("Downloaded rug image is empty.");
  }

  const mimeType = toStringOrNull(download.data.type) ?? inferMimeTypeFromPath(input.path);
  return { bytes, mimeType };
}

function buildEnhancedStoragePath(input: {
  tenantId: string;
  rugId: string;
  sourcePath: string;
  model: string;
  mimeType: string;
}): string {
  const normalizedSourcePath = normalizeStoragePath(input.sourcePath) ?? input.sourcePath;
  const segments = normalizedSourcePath.split("/");
  const directory =
    segments.length > 1
      ? segments.slice(0, -1).join("/")
      : `${input.tenantId}/${input.rugId}`;
  const modelSegment = sanitizeForPathSegment(input.model) || "gemini-image";
  const extension = extensionForMimeType(input.mimeType);
  return `${directory}/enhanced-${modelSegment}-${Date.now()}.${extension}`;
}

function buildGeminiEnhancementPrompt(): string {
  return [
    "Create a premium e-commerce presentation image of this exact rug using one consistent standardized background.",
    "Use this exact background style every time: a clean light natural white-oak hardwood floor with a matte finish, wide planks, soft diffuse daylight, and a subtle natural contact shadow around the rug. No furniture, no decor, no walls, no additional styling objects, and no other rugs.",
    "This is a rug-preservation task. The rug must remain the exact same physical rug with all original details intact.",
    "Preserve exactly: colors and tonal character; pattern and small motifs; border design; fringe shape and irregularities; wear, pile variation, asymmetry, and imperfections; rug proportions and outline.",
    "Required composition: show only one rug; center the rug cleanly in frame; keep the full rug visible including all fringe; use a calm top-down merchandising presentation; remove any distracting store background outside the rug; if another rug, fringe, foot, furniture edge, tape, or object is visible around or under the main rug, remove it and replace only that non-rug area with the standardized oak floor.",
    "If part of the rug is cropped, cut off, blocked, or partially hidden, reconstruct only the missing rug area as faithfully as possible using the visible rug pattern, border structure, colors, fringe, and symmetry already present in the image.",
    "Only complete missing areas when the continuation is strongly supported by the visible rug. Do not invent new motifs, alter colors, or redesign the rug. The reconstructed area must match the existing rug exactly in style, wear, texture, and tonal character.",
    "Do not change the rug's color, contrast, saturation, lighting, texture, or detail. Do not simplify, redraw, smooth, sharpen, or invent motifs. Do not crop off fringe. Do not leave remnants of another rug under the main rug. Do not create a lifestyle room scene. Do not make the rug look newer, cleaner, flatter, or more luxurious than it really is.",
    "Return only the final enhanced image.",
  ].join(" ");
}

function getCandidateParts(candidate: unknown): unknown[] {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return [];
  }

  const content = (candidate as { content?: unknown }).content;
  if (!content || typeof content !== "object" || Array.isArray(content)) {
    return [];
  }

  return Array.isArray((content as { parts?: unknown[] }).parts)
    ? (content as { parts: unknown[] }).parts
    : [];
}

function getInlineData(part: unknown): {
  data: string;
  mimeType: string;
} | null {
  if (!part || typeof part !== "object" || Array.isArray(part)) return null;

  const record = part as {
    inlineData?: { data?: unknown; mimeType?: unknown };
    inline_data?: { data?: unknown; mime_type?: unknown };
  };
  const camel = record.inlineData;
  const snake = record.inline_data;
  const base64Data =
    typeof camel?.data === "string"
      ? camel.data.trim()
      : typeof snake?.data === "string"
        ? snake.data.trim()
        : "";

  if (!base64Data) return null;

  const mimeType =
    typeof camel?.mimeType === "string"
      ? camel.mimeType
      : typeof snake?.mime_type === "string"
        ? snake.mime_type
        : "image/png";

  return { data: base64Data, mimeType };
}

async function requestGeminiEnhancedImage(input: {
  sourceBytes: Buffer;
  sourceMimeType: string;
  model: string;
}): Promise<{ bytes: Buffer; mimeType: string }> {
  const response = await fetch(
    `${GEMINI_API_BASE_URL}/${encodeURIComponent(input.model)}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": GEMINI_API_KEY,
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: buildGeminiEnhancementPrompt() },
              {
                inline_data: {
                  mime_type: input.sourceMimeType,
                  data: input.sourceBytes.toString("base64"),
                },
              },
            ],
          },
        ],
        generationConfig: {
          responseModalities: ["Image"],
        },
      }),
    }
  );

  let payload: unknown = null;
  try {
    payload = (await response.json()) as unknown;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const message =
      payload &&
      typeof payload === "object" &&
      !Array.isArray(payload) &&
      typeof (payload as { error?: { message?: unknown } }).error?.message === "string"
        ? (payload as { error: { message: string } }).error.message
        : `Gemini image enhancement failed with status ${response.status}.`;
    throw new Error(message);
  }

  const candidates =
    payload &&
    typeof payload === "object" &&
    !Array.isArray(payload) &&
    Array.isArray((payload as { candidates?: unknown[] }).candidates)
      ? (payload as { candidates: unknown[] }).candidates
      : [];

  for (const candidate of candidates) {
    const parts = getCandidateParts(candidate);
    for (const part of parts) {
      const inlineData = getInlineData(part);
      if (!inlineData) continue;

      return {
        bytes: Buffer.from(inlineData.data, "base64"),
        mimeType: inlineData.mimeType,
      };
    }
  }

  const textParts: string[] = [];
  for (const candidate of candidates) {
    const parts = getCandidateParts(candidate);
    for (const part of parts) {
      if (!part || typeof part !== "object" || Array.isArray(part)) continue;
      const text = typeof (part as { text?: unknown }).text === "string"
        ? (part as { text: string }).text.trim()
        : "";
      if (text) textParts.push(text);
    }
  }

  throw new Error(
    textParts[0] || "Gemini did not return an enhanced image payload."
  );
}

export async function enhanceRugPrimaryImage(input: {
  supabase: SupabaseClient;
  tenantId: string;
  rugId: string;
  model?: string;
}): Promise<EnhanceRugPrimaryImageResult> {
  const model = input.model ?? GEMINI_IMAGE_ENHANCEMENT_MODEL;
  const row = await fetchRugImageRow(input);
  if (!row) {
    throw new Error("Primary rug image record is missing.");
  }

  const activePath = normalizeStoragePath(row.path);
  const originalPath = normalizeStoragePath(row.original_path) ?? activePath;
  if (!activePath || !originalPath) {
    throw new Error("Primary rug image path is missing.");
  }

  let uploadedEnhancedPath: string | null = null;

  try {
    await updateRugImageRow({
      supabase: input.supabase,
      tenantId: input.tenantId,
      rugId: input.rugId,
      payload: {
        original_path: originalPath,
        enhancement_status: "processing",
        enhancement_error: null,
      },
    });

    const sourceImage = await downloadStorageObject({
      supabase: input.supabase,
      path: originalPath,
    });

    const enhancedImage = await requestGeminiEnhancedImage({
      sourceBytes: sourceImage.bytes,
      sourceMimeType: sourceImage.mimeType,
      model,
    });

    uploadedEnhancedPath = buildEnhancedStoragePath({
      tenantId: input.tenantId,
      rugId: input.rugId,
      sourcePath: originalPath,
      model,
      mimeType: enhancedImage.mimeType,
    });

    const upload = await input.supabase.storage
      .from(RUG_IMAGES_BUCKET)
      .upload(uploadedEnhancedPath, enhancedImage.bytes, {
        contentType: enhancedImage.mimeType,
        upsert: false,
      });

    if (upload.error) {
      throw new Error(upload.error.message ?? "Unable to upload enhanced rug image.");
    }

    await updateRugImageRow({
      supabase: input.supabase,
      tenantId: input.tenantId,
      rugId: input.rugId,
      payload: {
        path: uploadedEnhancedPath,
        original_path: originalPath,
        enhancement_status: "ready",
        enhancement_model: model,
        enhanced_at: new Date().toISOString(),
        enhancement_error: null,
      },
    });

    if (activePath !== originalPath && activePath !== uploadedEnhancedPath) {
      await input.supabase.storage
        .from(RUG_IMAGES_BUCKET)
        .remove([activePath])
        .catch(() => null);
    }

    return {
      displayPath: uploadedEnhancedPath,
      originalPath,
      model,
    };
  } catch (error) {
    if (uploadedEnhancedPath) {
      await input.supabase.storage
        .from(RUG_IMAGES_BUCKET)
        .remove([uploadedEnhancedPath])
        .catch(() => null);
    }

    const message =
      error instanceof Error ? truncateErrorMessage(error.message) : "Image enhancement failed.";

    await updateRugImageRow({
      supabase: input.supabase,
      tenantId: input.tenantId,
      rugId: input.rugId,
      payload: {
        original_path: originalPath,
        enhancement_status: "failed",
        enhancement_error: message,
      },
    }).catch(() => null);

    throw new Error(message);
  }
}

export async function resetRugImageEnhancementState(input: {
  supabase: SupabaseClient;
  tenantId: string;
  rugId: string;
}): Promise<void> {
  const row = await fetchRugImageRow(input);
  if (!row) return;

  const activePath = normalizeStoragePath(row.path);
  const originalPath = normalizeStoragePath(row.original_path) ?? activePath;
  if (!activePath && !originalPath) return;

  await updateRugImageRow({
    supabase: input.supabase,
    tenantId: input.tenantId,
    rugId: input.rugId,
    payload: {
      original_path: originalPath,
      enhancement_status: "not_started",
      enhancement_model: null,
      enhanced_at: null,
      enhancement_error: null,
    },
  });
}
