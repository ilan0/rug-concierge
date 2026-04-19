#!/usr/bin/env tsx

import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

type EnvMap = Record<string, string>;

const ONE_BY_ONE_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9pV4Vp8AAAAASUVORK5CYII=";

function loadEnv(): EnvMap {
  const env: EnvMap = {};
  const candidates = [
    path.resolve(process.cwd(), ".env.local"),
    path.resolve(process.cwd(), "apps/web/.env.local"),
    path.resolve(__dirname, "../../apps/web/.env.local"),
  ];
  const envPath = candidates.find((candidate) => fs.existsSync(candidate));
  if (!envPath) {
    throw new Error("Unable to locate apps/web/.env.local");
  }
  const content = fs.readFileSync(envPath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index <= 0) continue;
    env[line.slice(0, index)] = line.slice(index + 1).trim();
  }
  return env;
}

function parseArgs(argv: string[]) {
  const args: Record<string, string> = {};
  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const index = arg.indexOf("=");
    if (index === -1) {
      args[arg.slice(2)] = "true";
      continue;
    }
    args[arg.slice(2, index)] = arg.slice(index + 1);
  }
  return {
    tenantId: args["tenant-id"] ?? "d0d97eca-5384-4f35-a970-db7031c188b0",
  };
}

async function cleanup(input: {
  supabase: ReturnType<typeof createClient>;
  tenantId: string;
  rugId: string | null;
  storagePath: string;
}) {
  if (input.rugId) {
    await input.supabase
      .from("inventory_enrichment_jobs")
      .delete()
      .eq("tenant_id", input.tenantId)
      .eq("rug_id", input.rugId);
    await input.supabase
      .from("rug_images")
      .delete()
      .eq("tenant_id", input.tenantId)
      .eq("rug_id", input.rugId);
    await input.supabase
      .from("rugs")
      .delete()
      .eq("tenant_id", input.tenantId)
      .eq("id", input.rugId);
  }

  await input.supabase.storage
    .from("rug-images")
    .remove([input.storagePath])
    .catch(() => null);
}

async function main() {
  const env = loadEnv();
  for (const [key, value] of Object.entries(env)) {
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
  const { tenantId } = parseArgs(process.argv.slice(2));
  const [
    {
      claimInventoryEnrichmentJobs,
      enqueueInventoryEnrichmentJob,
      processInventoryEnrichmentJob,
    },
    { fetchRugRecordById },
  ] =
    await Promise.all([
      import("../../apps/web/lib/inventory/enrichment-jobs"),
      import("../../apps/web/lib/inventory/rug-record"),
    ]);
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false },
  });

  const rugId = randomUUID();
  const storagePath = `${tenantId}/smoke/${rugId}.png`;
  const fileBytes = Buffer.from(ONE_BY_ONE_PNG_BASE64, "base64");
  const imageSha256 = createHash("sha256").update(fileBytes).digest("hex");
  let createdRugId: string | null = null;

  try {
    const upload = await supabase.storage
      .from("rug-images")
      .upload(storagePath, fileBytes, {
        contentType: "image/png",
        upsert: false,
      });
    if (upload.error) {
      throw new Error(`Storage upload failed: ${upload.error.message}`);
    }

    const rugInsert = await supabase
      .from("rugs")
      .insert({
        id: rugId,
        tenant_id: tenantId,
        stock_id: `SMOKE-${rugId.slice(0, 8).toUpperCase()}`,
        status: "not_available",
        enrichment_status: "processing",
        review_reason_code: null,
        intake_label: "Smoke Test Rug",
        width_ft: 8,
        width_in: 0,
        length_ft: 10,
        length_in: 0,
      })
      .select("id")
      .single();
    if (rugInsert.error || !rugInsert.data?.id) {
      throw new Error(`Unable to create smoke rug: ${rugInsert.error?.message ?? "unknown"}`);
    }
    createdRugId = rugInsert.data.id;

    const rugImageInsert = await supabase.from("rug_images").insert({
      tenant_id: tenantId,
      rug_id: createdRugId,
      path: storagePath,
      image_sha256: imageSha256,
    });
    if (rugImageInsert.error) {
      throw new Error(`Unable to create smoke rug image: ${rugImageInsert.error.message}`);
    }

    const enqueue = await enqueueInventoryEnrichmentJob({
      tenantId,
      rugId: createdRugId,
      restoreAvailableOnReady: true,
      supabase,
    });
    assert.equal(enqueue.ok, true);

    const claimed = await claimInventoryEnrichmentJobs({
      workerId: `smoke-${rugId}`,
      tenantId,
      limit: 1,
      supabase,
    });
    const job = claimed.find((row) => row.rug_id === createdRugId);
    assert.ok(job, "Expected the smoke rug job to be claimable");

    const outcome = await processInventoryEnrichmentJob({
      supabase,
      job: job!,
      requestVisionEnrichmentFn: async () => ({
        intakeLabel: "Traditional Oushak-Style Rug",
        aiDescription:
          "A traditional rug with a soft floral field and muted border palette.",
        aiStructuredFields: {
          origin: "Turkish",
          origin_confidence: "low",
          style: "Oushak",
          style_confidence: "medium",
          pattern: ["floral motif", "floral border"],
          primary_colors: ["ivory", "rust", "blue"],
          age_category: "traditional",
          mood: "traditional",
          is_rug: true,
          is_rug_confidence: "high",
        },
      }),
    });
    assert.equal(outcome, "ready");

    const rug = await fetchRugRecordById({
      supabase,
      tenantId,
      id: createdRugId!,
    });
    assert.ok(rug);
    assert.equal(rug?.enrichment_status, "ready");
    assert.equal(rug?.status, "available");
    assert.equal(rug?.intake_label, "Traditional Oushak-Style Rug");
    assert.equal(rug?.ai_structured_fields?.origin_confidence, "low");
    assert.equal(rug?.ai_structured_fields?.style_confidence, "medium");

    console.log("[intake-attribution-smoke] passed", {
      tenant_id: tenantId,
      rug_id: createdRugId,
    });
  } finally {
    await cleanup({
      supabase,
      tenantId,
      rugId: createdRugId,
      storagePath,
    });
  }
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : String(error)
  );
  process.exit(1);
});
