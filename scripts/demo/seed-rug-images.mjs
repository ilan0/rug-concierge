#!/usr/bin/env node

/**
 * Demo-only seeder for rug images generated with OpenAI Image API.
 *
 * This script:
 * - reads all tenants
 * - reads all rugs per tenant (paged)
 * - generates one realistic product photo per rug
 * - uploads to Supabase Storage bucket "rug-images"
 * - upserts rows in public.rug_images
 *
 * It is intentionally standalone and not imported by app runtime.
 */

const STORAGE_BUCKET = "rug-images";
const RUG_PAGE_SIZE = 500;
const OPENAI_MODEL = "gpt-image-1.5";
const OPENAI_IMAGE_SIZE = "1024x1024";
const OPENAI_IMAGE_QUALITY = "medium";
const OPENAI_OUTPUT_FORMAT = "webp";
const REQUEST_DELAY_MS = 300;
const MAX_ATTEMPTS = 2;
const OPENAI_IMAGES_URL = "https://api.openai.com/v1/images/generations";
const OPENAI_GENERATION_TIMEOUT_MS = 60000;
const OPENAI_FETCH_URL_TIMEOUT_MS = 30000;

const BASE_PROMPT =
  "Top-down flat lay studio product photo of an area rug. Photorealistic woven texture, crisp edges, centered on a clean neutral background. No room scene. No furniture. No people. No watermark. No text. Soft even studio lighting. High detail fibers.";

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 30000;
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function readRequiredEnv() {
  const supabaseUrl = (
    process.env.SUPABASE_URL ??
    process.env.NEXT_PUBLIC_SUPABASE_URL ??
    ""
  ).trim();
  const supabaseSecretKey = (process.env.SUPABASE_SECRET_KEY ?? "").trim();
  const openAiApiKey = (process.env.OPENAI_API_KEY ?? "").trim();

  if (!supabaseUrl || !supabaseSecretKey) {
    console.error(
      "[seed-rug-images] Missing required env. Expected SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SECRET_KEY."
    );
    process.exit(1);
  }

  if (!openAiApiKey) {
    console.error(
      "[seed-rug-images] Missing OPENAI_API_KEY. Set it before running this script."
    );
    process.exit(1);
  }

  return { supabaseUrl, supabaseSecretKey, openAiApiKey };
}

async function loadDeps() {
  let createClient;
  try {
    const supabaseMod = await import("@supabase/supabase-js");
    createClient = supabaseMod.createClient;
  } catch (error) {
    console.error(
      "[seed-rug-images] Failed to load @supabase/supabase-js:",
      error instanceof Error ? error.message : String(error)
    );
    process.exit(1);
  }

  return { createClient };
}

function toSafeText(value, fallback = "") {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function buildImagePrompt(rug) {
  const styleText = toSafeText(rug.intake_label, rug.id);
  return `${BASE_PROMPT} Rug style: ${styleText}.`;
}

function decodeBase64ImageToBuffer(base64Image) {
  if (typeof base64Image !== "string" || base64Image.trim().length === 0) {
    return null;
  }

  try {
    return Buffer.from(base64Image, "base64");
  } catch {
    return null;
  }
}

async function fetchBinaryFromUrl(url, openAiApiKey) {
  const response = await fetchWithTimeout(
    url,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${openAiApiKey}`,
      },
    },
    OPENAI_FETCH_URL_TIMEOUT_MS
  );

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `OpenAI image URL fetch failed (${response.status}): ${text.slice(0, 240)}`
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function generateRugImageWebpFromOpenAi(input) {
  const { rug, openAiApiKey } = input;
  const prompt = buildImagePrompt(rug);

  const response = await fetchWithTimeout(
    OPENAI_IMAGES_URL,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openAiApiKey}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        prompt,
        size: OPENAI_IMAGE_SIZE,
        quality: OPENAI_IMAGE_QUALITY,
        output_format: OPENAI_OUTPUT_FORMAT,
        n: 1,
      }),
    },
    OPENAI_GENERATION_TIMEOUT_MS
  );

  const raw = await response.text();
  let payload = null;
  try {
    payload = JSON.parse(raw);
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const apiMessage =
      payload &&
      typeof payload === "object" &&
      payload.error &&
      typeof payload.error === "object" &&
      typeof payload.error.message === "string"
        ? payload.error.message
        : raw.slice(0, 300);
    throw new Error(`OpenAI image generation failed (${response.status}): ${apiMessage}`);
  }

  const dataArray =
    payload && typeof payload === "object" && Array.isArray(payload.data)
      ? payload.data
      : [];
  const first = dataArray.length > 0 && dataArray[0] && typeof dataArray[0] === "object"
    ? dataArray[0]
    : null;

  const b64Json =
    first && typeof first.b64_json === "string" ? first.b64_json : null;
  const url = first && typeof first.url === "string" ? first.url : null;

  if (b64Json) {
    const buffer = decodeBase64ImageToBuffer(b64Json);
    if (buffer && buffer.length > 0) return buffer;
  }

  if (url) {
    const buffer = await fetchBinaryFromUrl(url, openAiApiKey);
    if (buffer.length > 0) return buffer;
  }

  throw new Error("OpenAI image response did not include usable image data.");
}

async function fetchAllTenantIds(supabase) {
  const { data, error } = await supabase
    .from("tenants")
    .select("id")
    .order("id", { ascending: true });

  if (error) {
    throw new Error(`Failed to load tenants: ${error.message}`);
  }

  return (data ?? [])
    .map((row) => (typeof row?.id === "string" ? row.id.trim() : ""))
    .filter((id) => id.length > 0);
}

async function fetchRugsForTenant(supabase, tenantId) {
  const rows = [];
  let from = 0;

  while (true) {
    const to = from + RUG_PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from("rugs")
      .select("id, tenant_id, intake_label, sku")
      .eq("tenant_id", tenantId)
      .order("id", { ascending: true })
      .range(from, to);

    if (error) {
      throw new Error(
        `Failed to load rugs for tenant ${tenantId} [${from}-${to}]: ${error.message}`
      );
    }

    const batch = Array.isArray(data) ? data : [];
    rows.push(...batch);

    if (batch.length < RUG_PAGE_SIZE) break;
    from += RUG_PAGE_SIZE;
  }

  return rows;
}

async function fetchAllRugsAcrossTenants(supabase, tenantIds) {
  const all = [];
  for (const tenantId of tenantIds) {
    const tenantRugs = await fetchRugsForTenant(supabase, tenantId);
    all.push(...tenantRugs);
    console.log(
      `[seed-rug-images] tenant ${tenantId}: loaded ${tenantRugs.length} rugs`
    );
  }
  return all;
}

function normalizeRugRow(row) {
  const id = typeof row?.id === "string" ? row.id.trim() : "";
  const tenantId = typeof row?.tenant_id === "string" ? row.tenant_id.trim() : "";
  const intakeLabel =
    typeof row?.intake_label === "string" ? row.intake_label.trim() : "";
  const sku = typeof row?.sku === "string" ? row.sku.trim() : null;

  if (!id || !tenantId) return null;

  return {
    id,
    tenant_id: tenantId,
    intake_label: intakeLabel || id,
    sku,
  };
}

async function processRug(input) {
  const { supabase, rug, openAiApiKey } = input;
  const path = `tenant/${rug.tenant_id}/rugs/${rug.id}/primary.webp`;

  let imageBuffer = null;
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      imageBuffer = await generateRugImageWebpFromOpenAi({
        rug,
        openAiApiKey,
      });
      break;
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `[seed-rug-images] OpenAI attempt ${attempt}/${MAX_ATTEMPTS} failed tenant=${rug.tenant_id} rug=${rug.id}: ${message}`
      );
      if (attempt < MAX_ATTEMPTS) {
        await sleep(REQUEST_DELAY_MS);
      }
    }
  }

  if (!imageBuffer || imageBuffer.length === 0) {
    throw new Error(
      `Image generation failed after ${MAX_ATTEMPTS} attempt(s): ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`
    );
  }

  const { error: uploadError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(path, imageBuffer, {
      upsert: true,
      contentType: "image/webp",
      cacheControl: "3600",
    });

  if (uploadError) {
    throw new Error(`Storage upload failed: ${uploadError.message}`);
  }

  const { error: upsertError } = await supabase.from("rug_images").upsert(
    {
      tenant_id: rug.tenant_id,
      rug_id: rug.id,
      path,
      is_primary: true,
      sort_order: 0,
    },
    { onConflict: "rug_id" }
  );

  if (upsertError) {
    throw new Error(`rug_images upsert failed: ${upsertError.message}`);
  }

  const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
  const publicUrl = typeof data?.publicUrl === "string" ? data.publicUrl : null;

  return { path, publicUrl };
}

async function main() {
  const { supabaseUrl, supabaseSecretKey, openAiApiKey } = readRequiredEnv();
  const { createClient } = await loadDeps();

  const supabase = createClient(supabaseUrl, supabaseSecretKey, {
    auth: { persistSession: false },
  });

  const tenantIds = await fetchAllTenantIds(supabase);
  if (tenantIds.length === 0) {
    console.log("[seed-rug-images] No tenants found. Nothing to seed.");
    return;
  }

  console.log(
    `[seed-rug-images] Found ${tenantIds.length} tenant(s). Loading rugs...`
  );
  const rawRugs = await fetchAllRugsAcrossTenants(supabase, tenantIds);

  const counters = {
    total_rugs: rawRugs.length,
    created: 0,
    skipped: 0,
    failed: 0,
  };
  const samplePublicUrls = [];

  console.log(
    `[seed-rug-images] Processing ${counters.total_rugs} rug(s) across ${tenantIds.length} tenant(s)...`
  );

  for (let index = 0; index < rawRugs.length; index += 1) {
    const normalized = normalizeRugRow(rawRugs[index]);
    if (!normalized) {
      counters.skipped += 1;
      continue;
    }

    try {
      const result = await processRug({
        supabase,
        rug: normalized,
        openAiApiKey,
      });
      counters.created += 1;
      if (result.publicUrl && samplePublicUrls.length < 3) {
        samplePublicUrls.push(result.publicUrl);
      }
    } catch (error) {
      counters.failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `[seed-rug-images] Failed tenant=${normalized.tenant_id} rug=${normalized.id}: ${message}`
      );
    } finally {
      await sleep(REQUEST_DELAY_MS);
    }

    if ((index + 1) % 25 === 0 || index + 1 === rawRugs.length) {
      console.log(
        `[seed-rug-images] Progress ${index + 1}/${rawRugs.length} | created=${counters.created} skipped=${counters.skipped} failed=${counters.failed}`
      );
    }
  }

  console.log("\n[seed-rug-images] Summary");
  console.log(`- total rugs: ${counters.total_rugs}`);
  console.log(`- created: ${counters.created}`);
  console.log(`- skipped: ${counters.skipped}`);
  console.log(`- failed: ${counters.failed}`);

  console.log("\n[seed-rug-images] Example public URLs");
  if (samplePublicUrls.length === 0) {
    console.log("- (none generated)");
  } else {
    for (const url of samplePublicUrls) {
      console.log(`- ${url}`);
    }
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[seed-rug-images] Fatal error: ${message}`);
  process.exit(1);
});
