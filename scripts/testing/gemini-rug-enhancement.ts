#!/usr/bin/env tsx

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { rugImagePathToPublicUrl } from "../../apps/web/lib/storage/rug-images";

const DEMO_TENANT_ID = "d0d97eca-5384-4f35-a970-db7031c188b0";
const GEMINI_GENERATE_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent";
const DEFAULT_LIMIT = 15;
const ENHANCEMENT_MODEL = "gemini-2.5-flash-image";
const ENHANCEMENT_VARIANT = "default";
const ENHANCEMENT_SIZE = "native";
const ENHANCEMENT_OUTPUT_FORMAT = "native";
const API_REQUEST_TIMEOUT_MS = 120_000;
const FILE_DOWNLOAD_TIMEOUT_MS = 60_000;
const MAX_ENHANCEMENT_ATTEMPTS = 2;

type ScriptOptions = {
  limit: number;
  outDir: string | null;
  dryRun: boolean;
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
};

type ManifestFile = {
  generated_at: string;
  tenant_id: string;
  limit: number;
  dry_run: boolean;
  enhancement_model: string;
  enhancement_quality: string;
  enhancement_prompt_hash: string;
  entries: ManifestEntry[];
};

const ENHANCEMENT_PROMPT = [
  "Create a premium e-commerce presentation image of this exact rug using one consistent standardized background.",
  "Use this exact background style every time: a clean light natural white-oak hardwood floor with a matte finish, wide planks, soft diffuse daylight, and a subtle natural contact shadow around the rug. No furniture, no decor, no walls, no styling objects, and no other rugs.",
  "This is a rug-preservation task. The rug must remain the exact same physical rug with all original details intact.",
  "Preserve exactly: colors and tonal character, pattern and small motifs, border design, fringe shape and irregularities, wear, pile variation, asymmetry, imperfections, rug proportions, and rug outline.",
  "Required composition: show only one rug, center the rug cleanly in frame, keep the full rug visible including all fringe, and use a calm top-down merchandising presentation.",
  "Remove distracting store background outside the rug. If another rug, fringe, foot, furniture edge, tape, or object is visible around or under the main rug, remove it and replace only that non-rug area with the standardized oak floor.",
  "If part of the rug is cropped, cut off, blocked, folded under another rug, or partially hidden, reconstruct only the missing rug area as faithfully as possible using the visible rug pattern, border structure, colors, fringe, and symmetry already present in the image.",
  "Only complete missing rug areas when the continuation is strongly supported by the visible rug. The reconstructed area must match the existing rug exactly in style, wear, texture, tonal character, and level of detail.",
  "Do not change the rug's color, lighting, exposure, white balance, contrast, saturation, texture, sharpness, or detail.",
  "Do not simplify, redraw, smooth, sharpen, repair, clean up, or invent motifs or ornament details outside the minimum faithful completion needed for truly missing rug areas.",
  "Do not crop off fringe.",
  "Do not leave remnants of another rug under the main rug.",
  "Do not create a lifestyle room scene.",
  "Do not make the rug look newer, cleaner, flatter, or more luxurious than it really is.",
  "The result should look like the same real rug professionally staged on the same premium oak floor used for the entire catalog.",
].join(" ");

function usage(): never {
  console.error(
    [
      "Usage:",
      "  npm exec tsx -- scripts/testing/gemini-rug-enhancement.ts [--limit <n>] [--out-dir <dir>] [--dry-run]",
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

function parseArgs(argv: string[]): ScriptOptions {
  const options: ScriptOptions = {
    limit: DEFAULT_LIMIT,
    outDir: null,
    dryRun: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
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

function extractInlineData(block: Record<string, unknown>): Record<string, unknown> | null {
  const camel = block.inlineData;
  if (camel && typeof camel === "object") {
    return camel as Record<string, unknown>;
  }
  const snake = block.inline_data;
  if (snake && typeof snake === "object") {
    return snake as Record<string, unknown>;
  }
  return null;
}

function parseGeminiImageResponse(response: Response, payload: unknown): {
  buffer: Buffer;
  contentType: string;
} {
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in (payload as Record<string, unknown>)
        ? String(
            ((payload as Record<string, unknown>).error as Record<string, unknown>)
              ?.message ?? "Gemini image request failed."
          )
        : "Gemini image request failed.";
    throw new Error(`Gemini image request failed (${response.status}): ${message}`);
  }

  if (!payload || typeof payload !== "object") {
    throw new Error("Gemini image response missing payload.");
  }

  const candidates = (payload as Record<string, unknown>).candidates;
  if (!Array.isArray(candidates)) {
    throw new Error("Gemini image response missing candidates.");
  }

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") continue;
    const content = (candidate as Record<string, unknown>).content;
    if (!content || typeof content !== "object") continue;
    const parts = (content as Record<string, unknown>).parts;
    if (!Array.isArray(parts)) continue;

    for (const part of parts) {
      if (!part || typeof part !== "object") continue;
      const inline = extractInlineData(part as Record<string, unknown>);
      if (!inline) continue;
      const data = inline.data;
      if (typeof data !== "string" || data.trim().length === 0) continue;
      const mimeTypeValue = inline.mimeType ?? inline.mime_type;
      const contentType =
        typeof mimeTypeValue === "string" && mimeTypeValue.trim().length > 0
          ? mimeTypeValue
          : "image/png";
      return {
        buffer: Buffer.from(data, "base64"),
        contentType,
      };
    }
  }

  throw new Error("Gemini image response did not include inline image data.");
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
}): Promise<{
  buffer: Buffer;
  contentType: string;
  attempts: number;
  timingMs: number;
}> {
  const startedAt = Date.now();
  let attempts = 0;
  let lastError: Error | null = null;

  while (attempts < MAX_ENHANCEMENT_ATTEMPTS) {
    attempts += 1;
    try {
      const generationConfig: Record<string, unknown> = {
        responseModalities: ["Image"],
      };

      if (ENHANCEMENT_SIZE !== "native") {
        generationConfig.imageConfig = {
          imageSize: ENHANCEMENT_SIZE,
        };
      }

      const requestPayload = {
        contents: [
          {
            parts: [
              { text: ENHANCEMENT_PROMPT },
              {
                inline_data: {
                  mime_type: input.image.contentType,
                  data: input.image.buffer.toString("base64"),
                },
              },
            ],
          },
        ],
        generationConfig,
      };

      const response = await withTimeout(
        GEMINI_GENERATE_URL,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": input.apiKey,
          },
          body: JSON.stringify(requestPayload),
        },
        API_REQUEST_TIMEOUT_MS
      );

      const payload = (await response.json().catch(() => null)) as unknown;
      const parsed = parseGeminiImageResponse(response, payload);
      return {
        buffer: parsed.buffer,
        contentType: parsed.contentType,
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

function defaultOutputDir(): string {
  return path.join(process.cwd(), "tmp", "gemini-rug-enhancement", nowStamp());
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
    enhancement_quality: ENHANCEMENT_VARIANT,
    enhancement_prompt_hash: sha256(ENHANCEMENT_PROMPT),
    entries: [],
  };
}

function writeReviewFiles(outDir: string, manifest: ManifestFile) {
  const summary = {
    total: manifest.entries.length,
    enhanced_success: manifest.entries.filter(
      (entry) => entry.enhancement.status === "success"
    ).length,
    enhancement_error: manifest.entries.filter(
      (entry) => entry.enhancement.status === "error"
    ).length,
  };

  const reviewMd = [
    "# Gemini Rug Enhancement Review",
    "",
    `Generated: ${manifest.generated_at}`,
    `Tenant: ${manifest.tenant_id}`,
    `Total rugs: ${summary.total}`,
    `Enhancement success: ${summary.enhanced_success}`,
    `Enhancement errors: ${summary.enhancement_error}`,
    "",
    "| Stock ID | Label | Enhancement | Notes |",
    "| --- | --- | --- | --- |",
    ...manifest.entries.map((entry) => {
      const notes = entry.enhancement.error ?? "";
      return `| ${entry.stock_id ?? entry.rug_id} | ${entry.intake_label ?? ""} | ${entry.enhancement.status} | ${notes.replace(/\|/g, "\\|")} |`;
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
      return `
        <article class="card">
          <header>
            <h2>${escapeHtml(entry.stock_id ?? entry.rug_id)}</h2>
            <p>${escapeHtml(entry.intake_label ?? "")}</p>
            <span class="badge badge-${escapeHtml(entry.enhancement.status)}">${escapeHtml(entry.enhancement.status)}</span>
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
            <div><dt>Notes</dt><dd>${escapeHtml(entry.enhancement.error || "Manual review")}</dd></div>
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
  <title>Gemini Rug Enhancement Review</title>
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
  <h1>Gemini Rug Enhancement Review</h1>
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
  const geminiApiKey = readRequiredEnv("GEMINI_API_KEY");
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
    `[gemini-rug-enhancement] Demo tenant ${DEMO_TENANT_ID}: found ${rugs.length} candidate rugs.`
  );

  if (options.dryRun) {
    console.log(`[gemini-rug-enhancement] Dry run only. Planned output dir: ${outDir}`);
    console.log(
      `[gemini-rug-enhancement] Enhancement: ${ENHANCEMENT_MODEL} (${ENHANCEMENT_VARIANT})`
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
        quality: ENHANCEMENT_VARIANT,
        size: ENHANCEMENT_SIZE,
        output_format: ENHANCEMENT_OUTPUT_FORMAT,
        prompt_hash: sha256(ENHANCEMENT_PROMPT),
        local_path: null,
        status: "pending",
        timing_ms: null,
        attempts: 0,
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
        apiKey: geminiApiKey,
        image: original,
      });
      const enhancedExtension = extFromContentType(enhancement.contentType);
      const enhancedPath = path.join(outDir, "enhanced", `${fileStem}${enhancedExtension}`);
      fs.writeFileSync(enhancedPath, enhancement.buffer);
      entry.enhancement.local_path = path.relative(process.cwd(), enhancedPath);
      entry.enhancement.status = "success";
      entry.enhancement.timing_ms = enhancement.timingMs;
      entry.enhancement.attempts = enhancement.attempts;
      entry.enhancement.output_format = enhancement.contentType;
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
      `[gemini-rug-enhancement] ${rug.stock_id ?? rug.id}: enhancement=${entry.enhancement.status}`
    );
  }

  writeReviewFiles(outDir, manifest);
  console.log(`[gemini-rug-enhancement] Artifacts written to ${outDir}`);
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Unknown script error."
  );
  process.exitCode = 1;
});
