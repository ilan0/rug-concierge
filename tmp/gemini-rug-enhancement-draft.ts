#!/usr/bin/env tsx

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { rugImagePathToPublicUrl } from "../../apps/web/lib/storage/rug-images";

const DEMO_TENANT_ID = "d0d97eca-5384-4f35-a970-db7031c188b0";
const OPENAI_EDITS_URL = "https://api.openai.com/v1/images/edits";
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const DEFAULT_LIMIT = 15;
const DEFAULT_QA_MODEL = "gpt-4.1-mini";
const ENHANCEMENT_MODEL = "gpt-image-1.5";
const DEFAULT_ENHANCEMENT_QUALITY = "low";
const ENHANCEMENT_SIZE = "1024x1024";
const ENHANCEMENT_OUTPUT_FORMAT = "webp";
const OPENAI_REQUEST_TIMEOUT_MS = 120_000;
const FILE_DOWNLOAD_TIMEOUT_MS = 60_000;
const MAX_ENHANCEMENT_ATTEMPTS = 2;
const ALLOWED_ENHANCEMENT_QUALITIES = new Set(["low", "medium"]);

type EnhancementQuality = "low" | "medium";

type ScriptOptions = {
  limit: number;
  outDir: string | null;
  skipQa: boolean;
  qaModel: string;
  dryRun: boolean;
  quality: EnhancementQuality;
};

type RugRow = {
  id: string;
  stock_id: string | null;
  intake_label: string | null;
};

type RugImageRow = {
  rug_id: string;
  path: string;
};

type DownloadedImage = {
  publicUrl: string;
  storagePath: string;
  contentType: string;
  extension: string;
  buffer: Buffer;
};

type QaVerdict = "pass" | "borderline" | "fail";

type QaResult = {
  verdict: QaVerdict;
  same_rug: boolean;
  color_preserved: boolean;
  pattern_preserved: boolean;
  border_fringe_preserved: boolean;
  artifacts_present: boolean;
  composition_improved: boolean;
  notes: string;
};

type ManifestEntry = {
  rug_id: string;
  stock_id: string | null;
  intake_label: string | null;
  original: {
    storage_path: string | null;
    public_url: string | null;
    local_path: string | null;
    content_type: string | null;
    download_status: "pending" | "success" | "error";
    error: string | null;
  };
  enhancement: {
    model: string;
    quality: string;
    size: string;
    output_format: string;
    prompt_hash: string;
    local_path: string | null;
    status: "pending" | "success" | "error";
    timing_ms: number | null;
    attempts: number;
    error: string | null;
  };
  qa: {
    model: string | null;
    prompt_hash: string | null;
    local_path: string | null;
    status: "pending" | "success" | "skipped" | "error";
    timing_ms: number | null;
    result: QaResult | null;
    error: string | null;
  };
};

type ManifestFile = {
  generated_at: string;
  tenant_id: string;
  limit: number;
  dry_run: boolean;
  enhancement_model: string;
  enhancement_quality: EnhancementQuality;
  enhancement_prompt_hash: string;
  qa_prompt_hash: string | null;
  entries: ManifestEntry[];
};

const QA_RESULT_SCHEMA = z
  .object({
    verdict: z.enum(["pass", "borderline", "fail"]),
    same_rug: z.boolean(),
    color_preserved: z.boolean(),
    pattern_preserved: z.boolean(),
    border_fringe_preserved: z.boolean(),
    artifacts_present: z.boolean(),
    composition_improved: z.boolean(),
    notes: z.string().trim().min(1).max(400),
  })
  .strict();

const QA_RESULT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "verdict",
    "same_rug",
    "color_preserved",
    "pattern_preserved",
    "border_fringe_preserved",
    "artifacts_present",
    "composition_improved",
    "notes",
  ],
  properties: {
    verdict: {
      type: "string",
      enum: ["pass", "borderline", "fail"],
    },
    same_rug: { type: "boolean" },
    color_preserved: { type: "boolean" },
    pattern_preserved: { type: "boolean" },
    border_fringe_preserved: { type: "boolean" },
    artifacts_present: { type: "boolean" },
    composition_improved: { type: "boolean" },
    notes: { type: "string", minLength: 1, maxLength: 400 },
  },
} as const;

const ENHANCEMENT_PROMPT = [
  "Enhance this photo of a real rug for premium e-commerce presentation while preserving exact rug fidelity.",
  "This is a composition and background cleanup task only, not a rug enhancement or redesign task.",
  "Treat every visible part of the rug as protected and preserve the exact same physical rug with all original details intact.",
  "Allowed changes are limited to: gently centering the composition, applying only minimal perspective correction if absolutely necessary, and simplifying or neutralizing distracting background outside the rug.",
  "Do not change lighting, exposure, white balance, tone, contrast, saturation, sharpness, blur, texture, or color anywhere on the rug.",
  "Do not wash out, brighten, darken, recolor, restyle, smooth, sharpen, repair, clean up, idealize, or reinterpret any part of the rug.",
  "Do not change small motifs, ornament details, border geometry, fringe irregularities, visible wear, pile variation, edge waviness, or any asymmetry.",
  "Do not invent, replace, remove, or simplify rug details.",
  "Do not fill in missing, cropped, blocked, or blurry rug regions in this version.",
  "If an edit would modify the rug itself in any way, do not make that edit.",
  "The final image should look like the same original rug photo with a less distracting surrounding environment, not like a newly generated image.",
].join(" ");

const QA_SYSTEM_PROMPT = [
  "You are reviewing a rug photo enhancement result.",
  "Image 1 is the original rug photo. Image 2 is the enhanced image.",
  "Be strict and fidelity-first.",
  "Fail the result if the rug itself appears changed in color, white balance, contrast, saturation, pattern, border design, fringe, proportions, texture, or visible wear, or if obvious AI artifacts are present.",
  "Fail the result if the rug looks washed out, cleaner, newer, flatter, more symmetrical, or otherwise re-rendered.",
  "Pass only if it is clearly the same rug and the enhancement mainly improves composition or background distraction without materially changing the rug.",
  "Return JSON only.",
].join(" ");

function usage(): never {
  console.error(
    [
      "Usage:",
      "  npm exec tsx -- scripts/testing/openai-rug-enhancement.ts [--limit <n>] [--out-dir <dir>] [--skip-qa] [--qa-model <model>] [--quality <low|medium>] [--dry-run]",
    ].join("\n")
  );
  process.exit(1);
}

function parsePositiveInt(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`${flag} must be a positive integer.`);
  }
  return parsed;
}

function parseEnhancementQuality(value: string): EnhancementQuality {
  const normalized = value.trim().toLowerCase();
  if (!ALLOWED_ENHANCEMENT_QUALITIES.has(normalized)) {
    throw new Error("--quality must be one of: low, medium.");
  }
  return normalized as EnhancementQuality;
}

function parseArgs(argv: string[]): ScriptOptions {
  const options: ScriptOptions = {
    limit: DEFAULT_LIMIT,
    outDir: null,
    skipQa: false,
    qaModel: DEFAULT_QA_MODEL,
    dryRun: false,
    quality: DEFAULT_ENHANCEMENT_QUALITY,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--skip-qa") {
      options.skipQa = true;
      continue;
    }
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--limit") {
      const next = argv[index + 1];
      if (!next) usage();
      options.limit = parsePositiveInt(next, "--limit");
      index += 1;
      continue;
    }
    if (arg === "--out-dir") {
      const next = argv[index + 1];
      if (!next) usage();
      options.outDir = next.trim();
      index += 1;
      continue;
    }
    if (arg === "--qa-model") {
      const next = argv[index + 1];
      if (!next) usage();
      options.qaModel = next.trim();
      index += 1;
      continue;
    }
    if (arg === "--quality") {
      const next = argv[index + 1];
      if (!next) usage();
      options.quality = parseEnhancementQuality(next);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function loadEnvFileIfExists(filePath: string) {
  if (!fs.existsSync(filePath)) return;

  const content = fs.readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const equalsIndex = line.indexOf("=");
    if (equalsIndex <= 0) continue;

    const key = line.slice(0, equalsIndex).trim();
    let value = line.slice(equalsIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function loadEnv() {
  const root = process.cwd();
  loadEnvFileIfExists(path.join(root, ".env.local"));
  loadEnvFileIfExists(path.join(root, "apps/web/.env.local"));
}

function readRequiredEnv(name: string): string {
  const value = process.env[name];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value.trim();
}

function nowStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function ensureDir(dirPath: string) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function withTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() =>
    clearTimeout(timer)
  );
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function toSafeBasename(value: string | null, fallback: string): string {
  const source = (value ?? fallback).trim();
  const safe = source.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  return safe.length > 0 ? safe : fallback;
}

function extFromContentType(contentType: string | null): string {
  const normalized = (contentType ?? "").toLowerCase();
  if (normalized.includes("image/jpeg")) return ".jpg";
  if (normalized.includes("image/png")) return ".png";
  if (normalized.includes("image/webp")) return ".webp";
  return ".img";
}

function mimeToDataUrl(contentType: string, buffer: Buffer): string {
  return `data:${contentType};base64,${buffer.toString("base64")}`;
}

function extractOutputText(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const data = payload as Record<string, unknown>;

  if (typeof data.output_text === "string" && data.output_text.trim().length > 0) {
    return data.output_text.trim();
  }

  if (!Array.isArray(data.output)) return null;
  for (const outputItem of data.output) {
    if (!outputItem || typeof outputItem !== "object") continue;
    const item = outputItem as Record<string, unknown>;
    if (!Array.isArray(item.content)) continue;

    for (const contentBlock of item.content) {
      if (!contentBlock || typeof contentBlock !== "object") continue;
      const block = contentBlock as Record<string, unknown>;
      if (typeof block.text === "string" && block.text.trim().length > 0) {
        return block.text.trim();
      }
    }
  }

  return null;
}

function parseQaPayload(payload: unknown): QaResult {
  const outputText = extractOutputText(payload);
  if (outputText) {
    const cleaned = outputText
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();
    const parsed = JSON.parse(cleaned);
    return QA_RESULT_SCHEMA.parse(parsed);
  }

  if (!payload || typeof payload !== "object") {
    throw new Error("QA payload missing output.");
  }

  const data = payload as Record<string, unknown>;
  if (!Array.isArray(data.output)) {
    throw new Error("QA payload missing output array.");
  }

  for (const item of data.output) {
    if (!item || typeof item !== "object") continue;
    const outputItem = item as Record<string, unknown>;
    if (!Array.isArray(outputItem.content)) continue;

    for (const part of outputItem.content) {
      if (!part || typeof part !== "object") continue;
      const block = part as Record<string, unknown>;
      if (block.json && typeof block.json === "object") {
        return QA_RESULT_SCHEMA.parse(block.json);
      }
    }
  }

  throw new Error("Unable to parse QA response.");
}

async function fetchBinaryFromUrl(
  url: string,
  apiKey: string,
  timeoutMs: number
): Promise<Buffer> {
  const response = await withTimeout(
    url,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    },
    timeoutMs
  );
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `OpenAI image URL fetch failed (${response.status}): ${text.slice(0, 300)}`
    );
  }
  return Buffer.from(await response.arrayBuffer());
}

async function parseImageResponse(
  response: Response,
  apiKey: string
): Promise<{ buffer: Buffer; status: number }> {
  const raw = await response.text();
  const payload = JSON.parse(raw) as Record<string, unknown>;

  if (!response.ok) {
    const message =
      payload?.error && typeof payload.error === "object"
        ? String((payload.error as Record<string, unknown>).message ?? raw.slice(0, 500))
        : raw.slice(0, 500);
    throw new Error(`OpenAI image request failed (${response.status}): ${message}`);
  }

  const first =
    Array.isArray(payload.data) && payload.data[0] && typeof payload.data[0] === "object"
      ? (payload.data[0] as Record<string, unknown>)
      : null;
  if (!first) {
    throw new Error("OpenAI image response missing data.");
  }

  if (typeof first.b64_json === "string" && first.b64_json.trim().length > 0) {
    return {
      buffer: Buffer.from(first.b64_json, "base64"),
      status: response.status,
    };
  }

  if (typeof first.url === "string" && first.url.trim().length > 0) {
    return {
      buffer: await fetchBinaryFromUrl(first.url, apiKey, FILE_DOWNLOAD_TIMEOUT_MS),
      status: response.status,
    };
  }

  throw new Error("OpenAI image response did not include usable image data.");
}

function isRetryableEnhancementError(message: string): boolean {
  return (
    message.includes("(429)") ||
    message.includes("(500)") ||
    message.includes("(502)") ||
    message.includes("(503)") ||
    message.includes("(504)") ||
    message.includes("AbortError") ||
    message.toLowerCase().includes("timed out")
  );
}

function createSupabase(): SupabaseClient {
  const supabaseUrl = readRequiredEnv("SUPABASE_URL");
  const supabaseSecret = readRequiredEnv("SUPABASE_SECRET_KEY");
  return createClient(supabaseUrl, supabaseSecret, {
    auth: { persistSession: false },
  });
}

async function listDemoRugs(
  supabase: SupabaseClient,
  limit: number
): Promise<RugRow[]> {
  const { data, error } = await supabase
    .from("rugs")
    .select("id, stock_id, intake_label")
    .eq("tenant_id", DEMO_TENANT_ID)
    .eq("status", "available")
    .eq("enrichment_status", "ready")
    .order("stock_id", { ascending: true })
    .order("id", { ascending: true })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to load demo rugs: ${error.message}`);
  }

  return (Array.isArray(data) ? data : []).filter(
    (row): row is RugRow =>
      Boolean(
        row &&
          typeof row === "object" &&
          typeof (row as { id?: unknown }).id === "string"
      )
  );
}

async function listRugImages(
  supabase: SupabaseClient,
  rugIds: string[]
): Promise<Map<string, RugImageRow>> {
  if (rugIds.length === 0) return new Map();

  const { data, error } = await supabase
    .from("rug_images")
    .select("rug_id, path")
    .eq("tenant_id", DEMO_TENANT_ID)
    .in("rug_id", rugIds);

  if (error) {
    throw new Error(`Failed to load rug images: ${error.message}`);
  }

  const map = new Map<string, RugImageRow>();
  for (const row of Array.isArray(data) ? data : []) {
    if (
      row &&
      typeof row === "object" &&
      typeof (row as { rug_id?: unknown }).rug_id === "string" &&
      typeof (row as { path?: unknown }).path === "string"
    ) {
      const typed = row as { rug_id: string; path: string };
      if (!map.has(typed.rug_id)) {
        map.set(typed.rug_id, {
          rug_id: typed.rug_id,
          path: typed.path,
        });
      }
    }
  }
  return map;
}

async function downloadOriginalImage(
  supabase: SupabaseClient,
  storagePath: string
): Promise<DownloadedImage> {
  const publicUrl = rugImagePathToPublicUrl(supabase, storagePath);
  if (!publicUrl) {
    throw new Error("Unable to resolve public URL for storage path.");
  }

  const response = await withTimeout(
    publicUrl,
    {
      method: "GET",
    },
    FILE_DOWNLOAD_TIMEOUT_MS
  );

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Original image download failed (${response.status}): ${text.slice(0, 240)}`);
  }

  const contentType = response.headers.get("content-type") ?? "application/octet-stream";
  return {
    publicUrl,
    storagePath,
    contentType,
    extension: extFromContentType(contentType),
    buffer: Buffer.from(await response.arrayBuffer()),
  };
}

async function requestEnhancement(input: {
  apiKey: string;
  image: DownloadedImage;
  quality: EnhancementQuality;
}): Promise<{ buffer: Buffer; attempts: number; timingMs: number }> {
  const startedAt = Date.now();
  let attempts = 0;
  let lastError: Error | null = null;

  while (attempts < MAX_ENHANCEMENT_ATTEMPTS) {
    attempts += 1;
    try {
      const form = new FormData();
      form.append("model", ENHANCEMENT_MODEL);
      form.append("prompt", ENHANCEMENT_PROMPT);
      form.append("quality", input.quality);
      form.append("size", ENHANCEMENT_SIZE);
      form.append("output_format", ENHANCEMENT_OUTPUT_FORMAT);
      form.append(
        "image",
        new Blob([input.image.buffer], { type: input.image.contentType }),
        `original${input.image.extension}`
      );

      const response = await withTimeout(
        OPENAI_EDITS_URL,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${input.apiKey}`,
          },
          body: form,
        },
        OPENAI_REQUEST_TIMEOUT_MS
      );

      const parsed = await parseImageResponse(response, input.apiKey);
      return {
        buffer: parsed.buffer,
        attempts,
        timingMs: Date.now() - startedAt,
      };
    } catch (error) {
      const nextError =
        error instanceof Error ? error : new Error("Unknown enhancement error.");
      lastError = nextError;
      if (attempts >= MAX_ENHANCEMENT_ATTEMPTS || !isRetryableEnhancementError(nextError.message)) {
        break;
      }
    }
  }

  throw lastError ?? new Error("Enhancement failed.");
}

async function requestQaReview(input: {
  apiKey: string;
  qaModel: string;
  original: DownloadedImage;
  enhancedBuffer: Buffer;
}): Promise<{ result: QaResult; timingMs: number }> {
  const startedAt = Date.now();
  const requestPayload = {
    model: input.qaModel,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: QA_SYSTEM_PROMPT,
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text:
              "Compare image 1 (original) against image 2 (enhanced). Decide whether the enhancement preserves the same rug while improving composition or lighting.",
          },
          {
            type: "input_image",
            image_url: mimeToDataUrl(input.original.contentType, input.original.buffer),
          },
          {
            type: "input_image",
            image_url: mimeToDataUrl("image/webp", input.enhancedBuffer),
          },
        ],
      },
    ],
    max_output_tokens: 220,
    text: {
      format: {
        type: "json_schema",
        name: "rug_enhancement_qa",
        schema: QA_RESULT_JSON_SCHEMA,
        strict: true,
      },
    },
  };

  const response = await withTimeout(
    OPENAI_RESPONSES_URL,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.apiKey}`,
      },
      body: JSON.stringify(requestPayload),
    },
    OPENAI_REQUEST_TIMEOUT_MS
  );

  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in (payload as Record<string, unknown>)
        ? String(((payload as Record<string, unknown>).error as Record<string, unknown>)?.message ?? "QA request failed.")
        : "QA request failed.";
    throw new Error(`QA request failed (${response.status}): ${message}`);
  }

  return {
    result: parseQaPayload(payload),
    timingMs: Date.now() - startedAt,
  };
}

function defaultOutputDir(): string {
  return path.join(process.cwd(), "tmp", "openai-rug-enhancement", nowStamp());
}

function writeJson(filePath: string, value: unknown) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n");
}

function buildManifest(options: ScriptOptions): ManifestFile {
  return {
    generated_at: new Date().toISOString(),
    tenant_id: DEMO_TENANT_ID,
    limit: options.limit,
    dry_run: options.dryRun,
    enhancement_model: ENHANCEMENT_MODEL,
    enhancement_quality: options.quality,
    enhancement_prompt_hash: sha256(ENHANCEMENT_PROMPT),
    qa_prompt_hash: options.skipQa ? null : sha256(QA_SYSTEM_PROMPT),
    entries: [],
  };
}

function writeReviewFiles(outDir: string, manifest: ManifestFile) {
  const summary = {
    total: manifest.entries.length,
    enhanced_success: manifest.entries.filter(
      (entry) => entry.enhancement.status === "success"
    ).length,
    qa_success: manifest.entries.filter((entry) => entry.qa.status === "success")
      .length,
    qa_pass: manifest.entries.filter((entry) => entry.qa.result?.verdict === "pass")
      .length,
    qa_borderline: manifest.entries.filter(
      (entry) => entry.qa.result?.verdict === "borderline"
    ).length,
    qa_fail: manifest.entries.filter((entry) => entry.qa.result?.verdict === "fail")
      .length,
  };

  const reviewMd = [
    "# OpenAI Rug Enhancement Review",
    "",
    `Generated: ${manifest.generated_at}`,
    `Tenant: ${manifest.tenant_id}`,
    `Total rugs: ${summary.total}`,
    `Enhancement success: ${summary.enhanced_success}`,
    `QA success: ${summary.qa_success}`,
    `QA pass/borderline/fail: ${summary.qa_pass}/${summary.qa_borderline}/${summary.qa_fail}`,
    "",
    "| Stock ID | Label | Enhancement | QA | Notes |",
    "| --- | --- | --- | --- | --- |",
    ...manifest.entries.map((entry) => {
      const verdict = entry.qa.result?.verdict ?? entry.qa.status;
      const notes = entry.qa.result?.notes ?? entry.qa.error ?? entry.enhancement.error ?? "";
      return `| ${entry.stock_id ?? entry.rug_id} | ${entry.intake_label ?? ""} | ${entry.enhancement.status} | ${verdict} | ${notes.replace(/\|/g, "\\|")} |`;
    }),
    "",
  ].join("\n");

  fs.writeFileSync(path.join(outDir, "review.md"), reviewMd);

  const cards = manifest.entries
    .map((entry) => {
      const originalPath = entry.original.local_path
        ? path.relative(outDir, path.resolve(process.cwd(), entry.original.local_path))
        : null;
      const enhancedPath = entry.enhancement.local_path
        ? path.relative(outDir, path.resolve(process.cwd(), entry.enhancement.local_path))
        : null;
      const verdict = entry.qa.result?.verdict ?? entry.qa.status;
      const notes = entry.qa.result?.notes ?? entry.qa.error ?? entry.enhancement.error ?? "";
      return `
        <article class="card">
          <header>
            <h2>${escapeHtml(entry.stock_id ?? entry.rug_id)}</h2>
            <p>${escapeHtml(entry.intake_label ?? "")}</p>
            <span class="badge badge-${escapeHtml(String(verdict))}">${escapeHtml(String(verdict))}</span>
          </header>
          <div class="images">
            <figure>
              <figcaption>Original</figcaption>
              ${
                originalPath
                  ? `<img src="${escapeHtml(originalPath)}" alt="Original rug photo for ${escapeHtml(entry.stock_id ?? entry.rug_id)}">`
                  : `<div class="missing">Missing original</div>`
              }
            </figure>
            <figure>
              <figcaption>Enhanced</figcaption>
              ${
                enhancedPath
                  ? `<img src="${escapeHtml(enhancedPath)}" alt="Enhanced rug photo for ${escapeHtml(entry.stock_id ?? entry.rug_id)}">`
                  : `<div class="missing">Enhancement failed</div>`
              }
            </figure>
          </div>
          <dl>
            <div><dt>Enhancement</dt><dd>${escapeHtml(entry.enhancement.status)}</dd></div>
            <div><dt>QA</dt><dd>${escapeHtml(String(verdict))}</dd></div>
            <div><dt>Notes</dt><dd>${escapeHtml(notes || "—")}</dd></div>
          </dl>
        </article>
      `;
    })
    .join("\n");

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>OpenAI Rug Enhancement Review</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f6f1ea; color: #2f241a; margin: 0; padding: 24px; }
    h1 { margin: 0 0 8px; }
    p.meta { margin: 0 0 24px; color: #6c5a49; }
    .grid { display: grid; gap: 20px; }
    .card { background: #fffaf4; border: 1px solid #decfb9; border-radius: 18px; padding: 18px; box-shadow: 0 10px 24px rgba(47, 36, 26, 0.06); }
    .card header { display: flex; gap: 12px; align-items: baseline; flex-wrap: wrap; margin-bottom: 14px; }
    .card h2 { margin: 0; font-size: 18px; }
    .card p { margin: 0; color: #6c5a49; }
    .images { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-bottom: 14px; }
    figure { margin: 0; }
    figcaption { margin-bottom: 6px; font-size: 13px; color: #6c5a49; }
    img { width: 100%; background: #f3ebdd; border-radius: 12px; border: 1px solid #decfb9; }
    .missing { min-height: 220px; display: grid; place-items: center; border-radius: 12px; border: 1px dashed #decfb9; background: #f8f4ee; color: #6c5a49; }
    dl { margin: 0; display: grid; gap: 8px; }
    dl div { display: grid; grid-template-columns: 120px 1fr; gap: 10px; }
    dt { font-weight: 600; }
    dd { margin: 0; color: #6c5a49; }
    .badge { display: inline-flex; align-items: center; border-radius: 999px; padding: 4px 10px; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; }
    .badge-pass { background: #e7f4ea; color: #205b31; }
    .badge-borderline { background: #f9f0d8; color: #7c5c10; }
    .badge-fail, .badge-error { background: #f7e7e5; color: #8b2d1f; }
    .badge-skipped, .badge-pending { background: #ece7df; color: #5a4b3e; }
  </style>
</head>
<body>
  <h1>OpenAI Rug Enhancement Review</h1>
  <p class="meta">Generated ${escapeHtml(manifest.generated_at)} · ${manifest.entries.length} rugs · enhancement model ${escapeHtml(manifest.enhancement_model)} (${escapeHtml(manifest.enhancement_quality)})</p>
  <section class="grid">${cards}</section>
</body>
</html>`;

  fs.writeFileSync(path.join(outDir, "index.html"), html);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function main() {
  loadEnv();
  const options = parseArgs(process.argv.slice(2));
  const apiKey = readRequiredEnv("OPENAI_API_KEY");
  const supabase = createSupabase();
  const outDir = options.outDir
    ? path.resolve(process.cwd(), options.outDir)
    : defaultOutputDir();

  const manifest = buildManifest(options);

  const rugs = await listDemoRugs(supabase, options.limit);
  const rugImages = await listRugImages(
    supabase,
    rugs.map((rug) => rug.id)
  );

  console.log(
    `[openai-rug-enhancement] Demo tenant ${DEMO_TENANT_ID}: found ${rugs.length} candidate rugs.`
  );

  if (options.dryRun) {
    console.log(`[openai-rug-enhancement] Dry run only. Planned output dir: ${outDir}`);
    console.log(
      `[openai-rug-enhancement] Enhancement: ${ENHANCEMENT_MODEL} (${options.quality})`
    );
    console.log(
      `[openai-rug-enhancement] QA: ${options.skipQa ? "skipped" : `enabled via ${options.qaModel}`}`
    );
    for (const rug of rugs) {
      const image = rugImages.get(rug.id);
      console.log(
        `- ${rug.stock_id ?? rug.id} :: ${rug.intake_label ?? "(untitled)"} :: ${
          image?.path ?? "missing image"
        }`
      );
    }
    return;
  }

  ensureDir(outDir);
  ensureDir(path.join(outDir, "originals"));
  ensureDir(path.join(outDir, "enhanced"));
  ensureDir(path.join(outDir, "qa"));

  for (const rug of rugs) {
    const imageRow = rugImages.get(rug.id);
    const fileStem = toSafeBasename(rug.stock_id, rug.id);
    const entry: ManifestEntry = {
      rug_id: rug.id,
      stock_id: rug.stock_id,
      intake_label: rug.intake_label,
      original: {
        storage_path: imageRow?.path ?? null,
        public_url: null,
        local_path: null,
        content_type: null,
        download_status: "pending",
        error: null,
      },
      enhancement: {
        model: ENHANCEMENT_MODEL,
        quality: options.quality,
        size: ENHANCEMENT_SIZE,
        output_format: ENHANCEMENT_OUTPUT_FORMAT,
        prompt_hash: sha256(ENHANCEMENT_PROMPT),
        local_path: null,
        status: "pending",
        timing_ms: null,
        attempts: 0,
        error: null,
      },
      qa: {
        model: options.skipQa ? null : options.qaModel,
        prompt_hash: options.skipQa ? null : sha256(QA_SYSTEM_PROMPT),
        local_path: null,
        status: options.skipQa ? "skipped" : "pending",
        timing_ms: null,
        result: null,
        error: null,
      },
    };
    manifest.entries.push(entry);

    if (!imageRow?.path) {
      entry.original.download_status = "error";
      entry.original.error = "Primary image path missing.";
      entry.enhancement.status = "error";
      entry.enhancement.error = "Skipped because primary image path is missing.";
      writeJson(path.join(outDir, "manifest.json"), manifest);
      continue;
    }

    try {
      const original = await downloadOriginalImage(supabase, imageRow.path);
      const originalPath = path.join(outDir, "originals", `${fileStem}${original.extension}`);
      fs.writeFileSync(originalPath, original.buffer);
      entry.original.public_url = original.publicUrl;
      entry.original.local_path = path.relative(process.cwd(), originalPath);
      entry.original.content_type = original.contentType;
      entry.original.download_status = "success";

      const enhancement = await requestEnhancement({
        apiKey,
        image: original,
        quality: options.quality,
      });
      const enhancedPath = path.join(outDir, "enhanced", `${fileStem}.webp`);
      fs.writeFileSync(enhancedPath, enhancement.buffer);
      entry.enhancement.local_path = path.relative(process.cwd(), enhancedPath);
      entry.enhancement.status = "success";
      entry.enhancement.timing_ms = enhancement.timingMs;
      entry.enhancement.attempts = enhancement.attempts;

      if (!options.skipQa) {
        try {
          const qa = await requestQaReview({
            apiKey,
            qaModel: options.qaModel,
            original,
            enhancedBuffer: enhancement.buffer,
          });
          const qaPath = path.join(outDir, "qa", `${fileStem}.json`);
          writeJson(qaPath, qa.result);
          entry.qa.local_path = path.relative(process.cwd(), qaPath);
          entry.qa.status = "success";
          entry.qa.timing_ms = qa.timingMs;
          entry.qa.result = qa.result;
        } catch (error) {
          entry.qa.status = "error";
          entry.qa.error =
            error instanceof Error ? error.message : "Unknown QA error.";
        }
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown enhancement failure.";
      if (entry.original.download_status === "pending") {
        entry.original.download_status = "error";
        entry.original.error = message;
      }
      entry.enhancement.status = "error";
      entry.enhancement.error = message;
    }

    writeJson(path.join(outDir, "manifest.json"), manifest);
    console.log(
      `[openai-rug-enhancement] ${rug.stock_id ?? rug.id}: enhancement=${entry.enhancement.status} qa=${entry.qa.status}`
    );
  }

  writeReviewFiles(outDir, manifest);
  console.log(`[openai-rug-enhancement] Artifacts written to ${outDir}`);
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Unknown script error."
  );
  process.exitCode = 1;
});
