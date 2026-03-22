#!/usr/bin/env tsx

import fs from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type DemoRugDefinition = {
  width_ft: number;
  width_in: number;
  length_ft: number;
  length_in: number;
  stock_id: string;
};

type LoadedImage = {
  source_url: string;
  content_type: "image/jpeg" | "image/png";
  buffer: Buffer;
};

type SeedResult = {
  stock_id: string;
  rug_id: string;
  image_path: string;
  status: "created" | "skipped" | "failed";
  reason?: string;
};

const STORAGE_BUCKET = "rug-images";
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_FETCH_TIMEOUT_MS = 30_000;
const MIN_REQUIRED_IMAGES = 8;
const IMAGE_FETCH_MAX_RETRIES = 4;
const IMAGE_FETCH_BASE_DELAY_MS = 900;

const DEMO_RUGS: DemoRugDefinition[] = [
  { width_ft: 5, width_in: 3, length_ft: 7, length_in: 6, stock_id: "DEMO-001" },
  { width_ft: 8, width_in: 0, length_ft: 10, length_in: 0, stock_id: "DEMO-002" },
  { width_ft: 9, width_in: 0, length_ft: 12, length_in: 0, stock_id: "DEMO-003" },
  { width_ft: 2, width_in: 6, length_ft: 10, length_in: 0, stock_id: "DEMO-004" },
  { width_ft: 6, width_in: 0, length_ft: 9, length_in: 0, stock_id: "DEMO-005" },
  { width_ft: 4, width_in: 0, length_ft: 6, length_in: 0, stock_id: "DEMO-006" },
  { width_ft: 8, width_in: 0, length_ft: 10, length_in: 0, stock_id: "DEMO-007" },
  { width_ft: 10, width_in: 0, length_ft: 14, length_in: 0, stock_id: "DEMO-008" },
];

const FALLBACK_IMAGE_URLS = [
  "https://images.metmuseum.org/CRDImages/is/web-large/DP229999.jpg",
  "https://images.metmuseum.org/CRDImages/as/web-large/4732.jpg",
  "https://images.metmuseum.org/CRDImages/cl/web-large/dp247407.jpg",
  "https://images.metmuseum.org/CRDImages/as/web-large/RT768.jpg",
  "https://images.metmuseum.org/CRDImages/as/web-large/64_23_4_O.JPG",
  "https://images.metmuseum.org/CRDImages/as/web-large/187399.jpg",
  "https://images.metmuseum.org/CRDImages/as/web-large/08_248_4_O.JPG",
  "https://images.metmuseum.org/CRDImages/as/web-large/RT668.jpg",
  "https://images.metmuseum.org/CRDImages/as/web-large/50602.jpg",
  "https://images.metmuseum.org/CRDImages/as/web-large/22_100_31_O.JPG",
  "https://images.metmuseum.org/CRDImages/as/web-large/7640.jpg",
  "https://images.metmuseum.org/CRDImages/as/web-large/50594.jpg",
] as const;

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
  const cwd = process.cwd();
  loadEnvFileIfExists(path.join(cwd, ".env.local"));
  loadEnvFileIfExists(path.join(cwd, "apps/web/.env.local"));
}

function readTrimmedEnv(name: string): string | null {
  const value = process.env[name];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function assertEnv(name: string): string {
  const value = readTrimmedEnv(name);
  if (!value) {
    throw new Error(`Missing ${name} environment variable.`);
  }
  return value;
}

async function fetchWithTimeout(url: string, timeoutMs = IMAGE_FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method: "GET",
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "user-agent": "rug-concierge-demo-seeder/1.0",
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeImageContentType(url: string, headerValue: string | null): "image/jpeg" | "image/png" | null {
  const header = (headerValue ?? "").toLowerCase();
  if (header.includes("image/jpeg")) return "image/jpeg";
  if (header.includes("image/png")) return "image/png";

  const lowerUrl = url.toLowerCase();
  if (lowerUrl.endsWith(".jpg") || lowerUrl.endsWith(".jpeg")) return "image/jpeg";
  if (lowerUrl.endsWith(".png")) return "image/png";
  return null;
}

async function fetchUsableImage(url: string): Promise<LoadedImage | null> {
  for (let attempt = 0; attempt < IMAGE_FETCH_MAX_RETRIES; attempt += 1) {
    if (attempt > 0) {
      await sleep(IMAGE_FETCH_BASE_DELAY_MS * (attempt + 1));
    }

    const response = await fetchWithTimeout(url).catch(() => null);
    if (!response) continue;

    if (response.status === 429 || response.status === 503) {
      continue;
    }
    if (!response.ok) return null;

    const contentType = normalizeImageContentType(url, response.headers.get("content-type"));
    if (!contentType) return null;

    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) return null;

    return {
      source_url: url,
      content_type: contentType,
      buffer: bytes,
    };
  }

  return null;
}

async function fetchWikimediaFileTitles(limit = 120): Promise<string[]> {
  const endpoint = new URL("https://commons.wikimedia.org/w/api.php");
  endpoint.searchParams.set("action", "query");
  endpoint.searchParams.set("list", "categorymembers");
  endpoint.searchParams.set("cmtitle", "Category:Oriental_rugs");
  endpoint.searchParams.set("cmlimit", String(limit));
  endpoint.searchParams.set("cmtype", "file");
  endpoint.searchParams.set("format", "json");

  const response = await fetchWithTimeout(endpoint.toString()).catch(() => null);
  if (!response || !response.ok) return [];

  const payload = (await response.json().catch(() => null)) as
    | {
        query?: { categorymembers?: Array<{ title?: string }> };
      }
    | null;

  const members = payload?.query?.categorymembers;
  if (!Array.isArray(members)) return [];

  return members
    .map((member) => (typeof member?.title === "string" ? member.title.trim() : ""))
    .filter((title) => title.startsWith("File:"));
}

async function resolveWikimediaImageUrl(fileTitle: string): Promise<string | null> {
  const endpoint = new URL("https://commons.wikimedia.org/w/api.php");
  endpoint.searchParams.set("action", "query");
  endpoint.searchParams.set("titles", fileTitle);
  endpoint.searchParams.set("prop", "imageinfo");
  endpoint.searchParams.set("iiprop", "url");
  endpoint.searchParams.set("iiurlwidth", "1600");
  endpoint.searchParams.set("format", "json");

  const response = await fetchWithTimeout(endpoint.toString()).catch(() => null);
  if (!response || !response.ok) return null;

  const payload = (await response.json().catch(() => null)) as
    | {
        query?: {
          pages?: Record<
            string,
            {
              imageinfo?: Array<{ url?: string; thumburl?: string }>;
            }
          >;
        };
      }
    | null;

  const pages = payload?.query?.pages;
  if (!pages || typeof pages !== "object") return null;

  for (const page of Object.values(pages)) {
    const first = Array.isArray(page.imageinfo) ? page.imageinfo[0] : null;
    if (first && typeof first.thumburl === "string" && first.thumburl.trim().length > 0) {
      return first.thumburl.trim();
    }
    if (first && typeof first.url === "string" && first.url.trim().length > 0) {
      return first.url.trim();
    }
  }

  return null;
}

async function loadImagePool(required: number): Promise<LoadedImage[]> {
  const candidateUrls: string[] = [];

  const titles = await fetchWikimediaFileTitles();
  for (const title of titles) {
    const url = await resolveWikimediaImageUrl(title);
    if (url) {
      candidateUrls.push(url);
    }
    if (candidateUrls.length >= required * 3) break;
  }

  for (const fallback of FALLBACK_IMAGE_URLS) {
    candidateUrls.push(fallback);
  }

  const unique = [...new Set(candidateUrls)];
  const accepted: LoadedImage[] = [];

  for (const url of unique) {
    await sleep(IMAGE_FETCH_BASE_DELAY_MS);
    const image = await fetchUsableImage(url);
    if (!image) continue;

    accepted.push(image);
    if (accepted.length >= required) break;
  }

  if (accepted.length < required) {
    throw new Error(
      `Unable to source ${required} usable images. Found ${accepted.length}.`
    );
  }

  return accepted;
}

async function ensureTenantExists(supabase: SupabaseClient, tenantId: string) {
  const { data, error } = await supabase
    .from("tenants")
    .select("id")
    .eq("id", tenantId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to query tenants: ${error.message}`);
  }
  if (data?.id === tenantId) return;

  const settingsProbe = await supabase.from("tenants").select("id, settings").limit(1);
  const supportsSettings = !settingsProbe.error;

  const payload = supportsSettings ? { id: tenantId, settings: {} } : { id: tenantId };
  const { error: insertError } = await supabase.from("tenants").insert(payload as never);
  if (insertError && !insertError.message.toLowerCase().includes("duplicate")) {
    throw new Error(`Failed to create tenant row: ${insertError.message}`);
  }
}

function imageExtension(contentType: LoadedImage["content_type"]): "jpg" | "png" {
  return contentType === "image/png" ? "png" : "jpg";
}

async function main() {
  loadEnv();

  const tenantId = assertEnv("TENANT_ID");
  const supabaseUrl = assertEnv("SUPABASE_URL");
  const supabaseKey = assertEnv("SUPABASE_SECRET_KEY");

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
  });

  await ensureTenantExists(supabase, tenantId);

  const stockIds = DEMO_RUGS.map((rug) => rug.stock_id);
  const { data: existingRows, error: existingError } = await supabase
    .from("rugs")
    .select("id, stock_id")
    .eq("tenant_id", tenantId)
    .in("stock_id", stockIds);

  if (existingError) {
    throw new Error(`Failed to query existing demo rugs: ${existingError.message}`);
  }

  const existingByStockId = new Map<string, string>();
  for (const row of existingRows ?? []) {
    if (typeof row?.stock_id === "string" && typeof row?.id === "string") {
      existingByStockId.set(row.stock_id, row.id);
    }
  }

  const missingDefs = DEMO_RUGS.filter((rug) => !existingByStockId.has(rug.stock_id));
  const results: SeedResult[] = DEMO_RUGS
    .filter((rug) => existingByStockId.has(rug.stock_id))
    .map((rug) => ({
      stock_id: rug.stock_id,
      rug_id: existingByStockId.get(rug.stock_id) ?? "",
      image_path: "",
      status: "skipped",
      reason: "stock_id already exists",
    }));

  if (missingDefs.length === 0) {
    console.log(
      JSON.stringify(
        {
          tenant_id: tenantId,
          created: 0,
          skipped: results.length,
          failed: 0,
          results,
        },
        null,
        2
      )
    );
    return;
  }

  const images = await loadImagePool(missingDefs.length);

  for (let index = 0; index < missingDefs.length; index += 1) {
    const definition = missingDefs[index];
    const image = images[index];
    const rugId = crypto.randomUUID();
    const ext = imageExtension(image.content_type);
    const storagePath = `${tenantId}/${rugId}/photo.${ext}`;

    try {
      const insertRug = await supabase
        .from("rugs")
        .insert({
          id: rugId,
          tenant_id: tenantId,
          stock_id: definition.stock_id,
          status: "available",
          intake_label: null,
          ai_description: null,
          ai_structured_fields: null,
          width_ft: definition.width_ft,
          width_in: definition.width_in,
          length_ft: definition.length_ft,
          length_in: definition.length_in,
        })
        .select("id")
        .single();

      if (insertRug.error || !insertRug.data) {
        throw new Error(insertRug.error?.message ?? "Failed to insert rug row");
      }

      const upload = await supabase.storage.from(STORAGE_BUCKET).upload(storagePath, image.buffer, {
        contentType: image.content_type,
        upsert: false,
      });
      if (upload.error) {
        throw new Error(`Storage upload failed: ${upload.error.message}`);
      }

      const insertImage = await supabase
        .from("rug_images")
        .insert({
          tenant_id: tenantId,
          rug_id: rugId,
          path: storagePath,
        })
        .select("rug_id")
        .single();
      if (insertImage.error || !insertImage.data) {
        throw new Error(insertImage.error?.message ?? "Failed to insert rug_images row");
      }

      results.push({
        stock_id: definition.stock_id,
        rug_id: rugId,
        image_path: storagePath,
        status: "created",
      });
    } catch (error) {
      // Best effort cleanup for partial insert.
      await supabase.from("rug_images").delete().eq("tenant_id", tenantId).eq("rug_id", rugId);
      await supabase.from("rugs").delete().eq("tenant_id", tenantId).eq("id", rugId);
      await supabase.storage.from(STORAGE_BUCKET).remove([storagePath]);

      results.push({
        stock_id: definition.stock_id,
        rug_id: rugId,
        image_path: storagePath,
        status: "failed",
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const created = results.filter((r) => r.status === "created").length;
  const skipped = results.filter((r) => r.status === "skipped").length;
  const failed = results.filter((r) => r.status === "failed").length;

  const summary = {
    tenant_id: tenantId,
    created,
    skipped,
    failed,
    results,
  };

  console.log(JSON.stringify(summary, null, 2));

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
