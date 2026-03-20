import fs from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const BASE_URL = process.env.SMOKE_BASE_URL ?? "http://127.0.0.1:4201";
const FORWARDED_FOR_BASE =
  process.env.SMOKE_FORWARDED_FOR_BASE ?? "198.18.30";
const ONE_BY_ONE_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X2ioAAAAASUVORK5CYII=";

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function loadEnvLocal() {
  const envPath = path.resolve("apps/web/.env.local");
  const text = await fs.readFile(envPath, "utf8");
  const out = {};

  for (const rawLine of text.split(/\r?\n/)) {
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
    out[key] = value;
  }

  return out;
}

function buildIntakeForm(input) {
  const bytes = Buffer.from(ONE_BY_ONE_PNG_BASE64, "base64");
  const file = new File([bytes], input.filename, { type: "image/png" });
  const form = new FormData();
  form.set("tenant_id", input.tenantId);
  form.set("stock_id", input.stockId);
  form.set("width_ft", String(input.widthFt));
  form.set("width_in", String(input.widthIn));
  form.set("length_ft", String(input.lengthFt));
  form.set("length_in", String(input.lengthIn));
  form.set("image", file);
  return form;
}

function hashForSeed(label) {
  const bytes = Buffer.from(`seed:${label}`, "utf8");
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("").slice(0, 64);
}

async function main() {
  const env = await loadEnvLocal();
  const tenantId = env.TENANT_ID?.trim();
  const passcode = env.STORE_PASSCODE?.trim();
  const supabaseUrl = env.SUPABASE_URL?.trim();
  const supabaseSecret = env.SUPABASE_SECRET_KEY?.trim();
  const cronSecret = env.CRON_SECRET?.trim() || process.env.CRON_SECRET?.trim() || "";

  assert(tenantId, "TENANT_ID missing in apps/web/.env.local");
  assert(passcode, "STORE_PASSCODE missing in apps/web/.env.local");
  assert(supabaseUrl, "SUPABASE_URL missing in apps/web/.env.local");
  assert(supabaseSecret, "SUPABASE_SECRET_KEY missing in apps/web/.env.local");
  assert(cronSecret, "CRON_SECRET missing in env (set it for dev server + script)");

  const supabase = createClient(supabaseUrl, supabaseSecret, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log("1) Unlocking staff session...");
  const unlockResponse = await fetch(`${BASE_URL}/api/auth/passcode`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": `${FORWARDED_FOR_BASE}.1`,
    },
    body: JSON.stringify({ passcode }),
  });
  assert(unlockResponse.ok, `Passcode unlock failed: ${unlockResponse.status}`);
  const setCookie = unlockResponse.headers.get("set-cookie");
  assert(setCookie, "Passcode unlock did not return set-cookie header");
  const cookieHeader = setCookie.split(";")[0];

  console.log("2) Creating intake row...");
  const stockId = `SMOKE-${Date.now()}`;
  const intakeResponse = await fetch(`${BASE_URL}/api/inventory/intake`, {
    method: "POST",
    headers: {
      cookie: cookieHeader,
      "x-forwarded-for": `${FORWARDED_FOR_BASE}.2`,
    },
    body: buildIntakeForm({
      tenantId,
      stockId,
      widthFt: 8,
      widthIn: 0,
      lengthFt: 10,
      lengthIn: 0,
      filename: "smoke-a.png",
    }),
  });
  assert(intakeResponse.ok, `Intake failed: ${intakeResponse.status}`);
  const intakePayload = await intakeResponse.json();
  const rugId = intakePayload?.rug?.id;
  assert(typeof rugId === "string", "Intake did not return rug.id");

  const rugRow = await supabase
    .from("rugs")
    .select("id, enrichment_status")
    .eq("tenant_id", tenantId)
    .eq("id", rugId)
    .single();
  assert(!rugRow.error, `Unable to read rug row: ${rugRow.error?.message}`);
  assert(rugRow.data?.enrichment_status === "processing", "New intake is not processing");

  const jobRow = await supabase
    .from("inventory_enrichment_jobs")
    .select("id, state")
    .eq("tenant_id", tenantId)
    .eq("rug_id", rugId)
    .maybeSingle();
  assert(!jobRow.error, `Unable to read enrichment job: ${jobRow.error?.message}`);
  assert(jobRow.data?.state === "queued", "Enrichment job not queued after intake");

  console.log("3) Verifying exact duplicate rejection...");
  const duplicateResponse = await fetch(`${BASE_URL}/api/inventory/intake`, {
    method: "POST",
    headers: {
      cookie: cookieHeader,
      "x-forwarded-for": `${FORWARDED_FOR_BASE}.3`,
    },
    body: buildIntakeForm({
      tenantId,
      stockId: `${stockId}-DUP`,
      widthFt: 8,
      widthIn: 0,
      lengthFt: 10,
      lengthIn: 0,
      filename: "smoke-a-copy.png",
    }),
  });
  assert(duplicateResponse.status === 409, `Duplicate response was ${duplicateResponse.status}, expected 409`);
  const duplicatePayload = await duplicateResponse.json();
  assert(
    duplicatePayload?.existing_rug?.id === rugId,
    "Duplicate response did not include existing rug id"
  );

  console.log("4) Triggering enrichment worker...");
  const workerResponse = await fetch(`${BASE_URL}/api/inventory/enrichment/worker`, {
    method: "POST",
    headers: { authorization: `Bearer ${cronSecret}` },
  });
  assert(workerResponse.ok, `Worker trigger failed: ${workerResponse.status}`);

  let finalStatus = "processing";
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await wait(1500);
    const currentRug = await supabase
      .from("rugs")
      .select("enrichment_status")
      .eq("tenant_id", tenantId)
      .eq("id", rugId)
      .single();
    assert(!currentRug.error, `Unable to poll rug status: ${currentRug.error?.message}`);
    finalStatus = currentRug.data?.enrichment_status ?? "processing";
    if (finalStatus === "ready" || finalStatus === "needs_review") break;

    const currentJob = await supabase
      .from("inventory_enrichment_jobs")
      .select("id, state, attempt_count, max_attempts")
      .eq("tenant_id", tenantId)
      .eq("rug_id", rugId)
      .maybeSingle();
    assert(!currentJob.error, `Unable to poll job state: ${currentJob.error?.message}`);
    if (
      currentJob.data &&
      currentJob.data.state === "retry_scheduled" &&
      currentJob.data.attempt_count < currentJob.data.max_attempts
    ) {
      await supabase
        .from("inventory_enrichment_jobs")
        .update({ next_attempt_at: new Date(0).toISOString() })
        .eq("id", currentJob.data.id);

      const forcedWorker = await fetch(`${BASE_URL}/api/inventory/enrichment/worker`, {
        method: "POST",
        headers: { authorization: `Bearer ${cronSecret}` },
      });
      assert(forcedWorker.ok, "Forced worker run failed");
    }
  }
  assert(
    finalStatus === "ready" || finalStatus === "needs_review",
    `Rug did not reach terminal enrichment status (got ${finalStatus})`
  );

  console.log("5) Re-enrich endpoint should enqueue and return processing...");
  const reEnrichResponse = await fetch(`${BASE_URL}/api/inventory/rugs/${rugId}/re-enrich`, {
    method: "POST",
    headers: { cookie: cookieHeader },
  });
  assert(reEnrichResponse.ok, `Re-enrich failed: ${reEnrichResponse.status}`);
  const reEnrichPayload = await reEnrichResponse.json();
  assert(
    reEnrichPayload?.enrichment_status === "processing",
    "Re-enrich did not set processing status"
  );
  const reEnrichJob = await supabase
    .from("inventory_enrichment_jobs")
    .select("state")
    .eq("tenant_id", tenantId)
    .eq("rug_id", rugId)
    .maybeSingle();
  assert(!reEnrichJob.error, `Unable to read job after re-enrich: ${reEnrichJob.error?.message}`);
  assert(Boolean(reEnrichJob.data), "Re-enrich did not leave an active job row");

  console.log("6) Delete endpoint should remove rug, images, and jobs...");
  const deleteResponse = await fetch(`${BASE_URL}/api/inventory/rugs/${rugId}`, {
    method: "DELETE",
    headers: { cookie: cookieHeader },
  });
  assert(deleteResponse.ok, `Delete failed: ${deleteResponse.status}`);

  const afterRug = await supabase
    .from("rugs")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("id", rugId)
    .maybeSingle();
  assert(!afterRug.error, `Unable to verify rug delete: ${afterRug.error?.message}`);
  assert(afterRug.data === null, "Rug row still exists after delete");

  const afterImages = await supabase
    .from("rug_images")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("rug_id", rugId);
  assert(!afterImages.error, `Unable to verify image delete: ${afterImages.error?.message}`);
  assert((afterImages.data ?? []).length === 0, "Image rows still exist after delete");

  const afterJobs = await supabase
    .from("inventory_enrichment_jobs")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("rug_id", rugId);
  assert(!afterJobs.error, `Unable to verify job delete: ${afterJobs.error?.message}`);
  assert((afterJobs.data ?? []).length === 0, "Job rows still exist after delete");

  console.log("7) Recommendation endpoint should exclude processing/needs_review rugs...");
  const readyId = crypto.randomUUID();
  const processingId = crypto.randomUUID();
  const needsReviewId = crypto.randomUUID();

  const seededRows = [
    {
      id: readyId,
      tenant_id: tenantId,
      status: "available",
      stock_id: `SMOKE-READY-${Date.now()}`,
      width_ft: 8,
      width_in: 0,
      length_ft: 10,
      length_in: 0,
      intake_label: "Antique Persian Heriz",
      ai_description: "Seed ready rug",
      ai_structured_fields: {
        origin: "Persian",
        style: "Heriz",
        age_category: "antique",
      },
      enrichment_status: "ready",
      review_reason_code: null,
    },
    {
      id: processingId,
      tenant_id: tenantId,
      status: "available",
      stock_id: `SMOKE-PROC-${Date.now()}`,
      width_ft: 8,
      width_in: 0,
      length_ft: 10,
      length_in: 0,
      intake_label: "Processing seed",
      ai_description: "Seed processing rug",
      ai_structured_fields: null,
      enrichment_status: "processing",
      review_reason_code: null,
    },
    {
      id: needsReviewId,
      tenant_id: tenantId,
      status: "available",
      stock_id: `SMOKE-REVIEW-${Date.now()}`,
      width_ft: 8,
      width_in: 0,
      length_ft: 10,
      length_in: 0,
      intake_label: "Needs review seed",
      ai_description: "Seed needs review rug",
      ai_structured_fields: null,
      enrichment_status: "needs_review",
      review_reason_code: "ANALYSIS_INCOMPLETE",
    },
  ];

  const seedInsert = await supabase.from("rugs").insert(seededRows);
  assert(!seedInsert.error, `Unable to seed rugs for recommend check: ${seedInsert.error?.message}`);

  const seedImages = await supabase.from("rug_images").insert([
    {
      tenant_id: tenantId,
      rug_id: readyId,
      path: `${tenantId}/${readyId}/smoke-ready.png`,
      image_sha256: hashForSeed(readyId),
    },
    {
      tenant_id: tenantId,
      rug_id: processingId,
      path: `${tenantId}/${processingId}/smoke-processing.png`,
      image_sha256: hashForSeed(processingId),
    },
    {
      tenant_id: tenantId,
      rug_id: needsReviewId,
      path: `${tenantId}/${needsReviewId}/smoke-needs-review.png`,
      image_sha256: hashForSeed(needsReviewId),
    },
  ]);
  assert(!seedImages.error, `Unable to seed images for recommend check: ${seedImages.error?.message}`);

  const recommendResponse = await fetch(`${BASE_URL}/api/recommend`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      tenant_id: tenantId,
      user_message: "Show me one rug around 8x10",
      constraints: {
        size: {
          widthIn: 96,
          lengthIn: 120,
          toleranceIn: 36,
        },
      },
    }),
  });
  assert(recommendResponse.ok, `Recommend failed: ${recommendResponse.status}`);
  const recommendPayload = await recommendResponse.json();
  const recommendationIds = Array.isArray(recommendPayload?.recommendations)
    ? recommendPayload.recommendations
        .map((row) => (typeof row?.rug_id === "string" ? row.rug_id : null))
        .filter(Boolean)
    : [];

  assert(
    !recommendationIds.includes(processingId),
    "Processing rug leaked into recommendation response"
  );
  assert(
    !recommendationIds.includes(needsReviewId),
    "Needs-review rug leaked into recommendation response"
  );

  await supabase.from("rugs").delete().eq("tenant_id", tenantId).in("id", [readyId, processingId, needsReviewId]);

  console.log("PASS: live endpoint smoke checks completed.");
}

main().catch((error) => {
  console.error("FAIL:", error instanceof Error ? error.message : error);
  process.exit(1);
});
