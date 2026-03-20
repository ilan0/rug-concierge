import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const BASE_URL = process.env.EDGE_BASE_URL ?? "http://127.0.0.1:4201";
const CRON_SECRET = process.env.CRON_SECRET?.trim() ?? "";
const FORWARDED_FOR_BASE =
  process.env.EDGE_FORWARDED_FOR_BASE ?? "198.18.40";
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X2ioAAAAASUVORK5CYII=";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadEnvLocal() {
  const envPath = path.resolve("apps/web/.env.local");
  const text = await fs.readFile(envPath, "utf8");
  const out = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function pngFile(name = "edge.png") {
  return new File([Buffer.from(PNG_BASE64, "base64")], name, { type: "image/png" });
}

function hashForSeed(seed) {
  return createHash("sha256").update(seed).digest("hex");
}

async function unlockStaff(passcode) {
  const response = await fetch(`${BASE_URL}/api/auth/passcode`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": `${FORWARDED_FOR_BASE}.1`,
    },
    body: JSON.stringify({ passcode }),
  });
  assert(response.ok, `Passcode unlock failed: ${response.status}`);
  const setCookie = response.headers.get("set-cookie");
  assert(setCookie, "Missing set-cookie from unlock endpoint");
  return setCookie.split(";")[0];
}

async function runWorker() {
  const response = await fetch(`${BASE_URL}/api/inventory/enrichment/worker`, {
    method: "POST",
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  });
  assert(response.ok, `Worker call failed: ${response.status}`);
  return response.json();
}

async function main() {
  assert(CRON_SECRET, "CRON_SECRET env var is required for this script");

  const env = await loadEnvLocal();
  const tenantId = env.TENANT_ID?.trim();
  const passcode = env.STORE_PASSCODE?.trim();
  const supabaseUrl = env.SUPABASE_URL?.trim();
  const supabaseSecret = env.SUPABASE_SECRET_KEY?.trim();

  assert(tenantId, "TENANT_ID missing in apps/web/.env.local");
  assert(passcode, "STORE_PASSCODE missing in apps/web/.env.local");
  assert(supabaseUrl, "SUPABASE_URL missing in apps/web/.env.local");
  assert(supabaseSecret, "SUPABASE_SECRET_KEY missing in apps/web/.env.local");

  const supabase = createClient(supabaseUrl, supabaseSecret, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const cookie = await unlockStaff(passcode);

  console.log("A) Worker failure -> terminal needs_review after max retries");
  const form = new FormData();
  form.set("tenant_id", tenantId);
  form.set("stock_id", `EDGE-FAIL-${Date.now()}`);
  form.set("width_ft", "8");
  form.set("width_in", "0");
  form.set("length_ft", "10");
  form.set("length_in", "0");
  form.set("image", pngFile("edge-failure.png"));

  const intakeResponse = await fetch(`${BASE_URL}/api/inventory/intake`, {
    method: "POST",
    headers: {
      cookie,
      "x-forwarded-for": `${FORWARDED_FOR_BASE}.2`,
    },
    body: form,
  });
  assert(intakeResponse.ok, `Edge intake failed: ${intakeResponse.status}`);
  const intakePayload = await intakeResponse.json();
  const rugId = intakePayload?.rug?.id;
  assert(typeof rugId === "string", "Edge intake response missing rug id");

  for (let i = 0; i < 4; i += 1) {
    await runWorker();

    const job = await supabase
      .from("inventory_enrichment_jobs")
      .select("id, state, attempt_count, max_attempts")
      .eq("tenant_id", tenantId)
      .eq("rug_id", rugId)
      .maybeSingle();
    assert(!job.error, `Unable to poll edge job: ${job.error?.message}`);
    if (!job.data) break;
    if (job.data.state === "needs_review") break;

    if (job.data.state === "retry_scheduled") {
      await supabase
        .from("inventory_enrichment_jobs")
        .update({ next_attempt_at: new Date(0).toISOString() })
        .eq("id", job.data.id);
      await wait(200);
    }
  }

  const failedRug = await supabase
    .from("rugs")
    .select("enrichment_status, review_reason_code")
    .eq("tenant_id", tenantId)
    .eq("id", rugId)
    .single();
  assert(!failedRug.error, `Unable to read failed rug: ${failedRug.error?.message}`);
  assert(
    failedRug.data?.enrichment_status === "needs_review",
    `Expected failed rug to be needs_review, got ${failedRug.data?.enrichment_status}`
  );
  assert(
    failedRug.data?.review_reason_code === "ANALYSIS_FAILED",
    `Expected ANALYSIS_FAILED, got ${failedRug.data?.review_reason_code}`
  );

  console.log("B) Reclaim stale processing lock older than 10 minutes");
  const staleRugId = randomUUID();
  const staleJobId = randomUUID();
  const staleLockedAt = new Date(Date.now() - 12 * 60_000).toISOString();

  const staleInsert = await supabase.from("rugs").insert({
    id: staleRugId,
    tenant_id: tenantId,
    status: "available",
    stock_id: `EDGE-STALE-${Date.now()}`,
    width_ft: 8,
    width_in: 0,
    length_ft: 10,
    length_in: 0,
    intake_label: "Edge stale processing",
    ai_description: null,
    ai_structured_fields: null,
    enrichment_status: "processing",
    review_reason_code: null,
  });
  assert(!staleInsert.error, `Unable to insert stale rug: ${staleInsert.error?.message}`);

  const staleJobInsert = await supabase.from("inventory_enrichment_jobs").insert({
    id: staleJobId,
    tenant_id: tenantId,
    rug_id: staleRugId,
    state: "processing",
    attempt_count: 0,
    max_attempts: 3,
    next_attempt_at: null,
    last_error: "Simulated stale lock",
    locked_at: staleLockedAt,
    lock_owner: "stale-worker",
    created_at: staleLockedAt,
    updated_at: staleLockedAt,
  });
  assert(!staleJobInsert.error, `Unable to insert stale job: ${staleJobInsert.error?.message}`);

  // Include a primary image record but point to a missing object so enrichment fails and exits.
  const staleImageInsert = await supabase.from("rug_images").insert({
    tenant_id: tenantId,
    rug_id: staleRugId,
    path: `${tenantId}/${staleRugId}/missing-edge-image.png`,
    image_sha256: hashForSeed(`stale:${staleRugId}`),
  });
  assert(!staleImageInsert.error, `Unable to insert stale image: ${staleImageInsert.error?.message}`);

  await runWorker();

  const reclaimedJob = await supabase
    .from("inventory_enrichment_jobs")
    .select("state, attempt_count")
    .eq("tenant_id", tenantId)
    .eq("rug_id", staleRugId)
    .single();
  assert(!reclaimedJob.error, `Unable to load reclaimed job: ${reclaimedJob.error?.message}`);
  assert(
    reclaimedJob.data?.state === "retry_scheduled" || reclaimedJob.data?.state === "needs_review",
    `Expected stale job to be reclaimed and progressed, got ${reclaimedJob.data?.state}`
  );

  await supabase.from("rugs").delete().eq("tenant_id", tenantId).in("id", [rugId, staleRugId]);

  console.log("PASS: edge worker checks completed.");
}

main().catch((error) => {
  console.error("FAIL:", error instanceof Error ? error.message : error);
  process.exit(1);
});
