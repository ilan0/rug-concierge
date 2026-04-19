#!/usr/bin/env tsx

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

type RugSeedRow = {
  id: string;
  tenant_id: string;
  status: "available" | "not_available" | null;
  enrichment_status: "processing" | "ready" | "needs_review" | null;
};

function loadEnv() {
  const candidates = [
    path.resolve(process.cwd(), ".env.local"),
    path.resolve(process.cwd(), "apps/web/.env.local"),
    path.resolve(__dirname, "../apps/web/.env.local"),
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
    const key = line.slice(0, index);
    const value = line.slice(index + 1).trim();
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
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
    tenantId: args["tenant-id"] ?? null,
  };
}

async function main() {
  loadEnv();
  const { tenantId } = parseArgs(process.argv.slice(2));
  const {
    enqueueInventoryEnrichmentJob,
    runInventoryEnrichmentWorker,
    setRugProcessingState,
  } = await import("../apps/web/lib/inventory/enrichment-jobs");
  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false },
  });

  let query = supabase
    .from("rugs")
    .select("id, tenant_id, status, enrichment_status")
    .order("tenant_id", { ascending: true })
    .order("created_at", { ascending: true });

  if (tenantId) {
    query = query.eq("tenant_id", tenantId);
  }

  const { data, error } = await query;
  if (error || !Array.isArray(data)) {
    throw new Error(error?.message ?? "Unable to query rugs.");
  }

  const rows: RugSeedRow[] = data
    .map((row) => ({
      id: typeof row.id === "string" ? row.id : "",
      tenant_id: typeof row.tenant_id === "string" ? row.tenant_id : "",
      status: row.status === "available" || row.status === "not_available" ? row.status : null,
      enrichment_status:
        row.enrichment_status === "processing" ||
        row.enrichment_status === "ready" ||
        row.enrichment_status === "needs_review"
          ? row.enrichment_status
          : null,
    }))
    .filter((row) => row.id && row.tenant_id);

  const grouped = new Map<string, RugSeedRow[]>();
  for (const row of rows) {
    const bucket = grouped.get(row.tenant_id) ?? [];
    bucket.push(row);
    grouped.set(row.tenant_id, bucket);
  }

  for (const [currentTenantId, tenantRows] of grouped) {
    console.log("[reprocess] queueing tenant", {
      tenant_id: currentTenantId,
      rugs: tenantRows.length,
    });

    for (const row of tenantRows) {
      const processingState = await setRugProcessingState({
        tenantId: currentTenantId,
        rugId: row.id,
        currentStatus: row.status,
        currentEnrichmentStatus: row.enrichment_status,
        supabase,
      });
      const enqueue = await enqueueInventoryEnrichmentJob({
        tenantId: currentTenantId,
        rugId: row.id,
        restoreAvailableOnReady: processingState.restoreAvailableOnReady,
        supabase,
      });
      if (!enqueue.ok) {
        throw new Error(
          `Unable to enqueue rug ${row.id} for tenant ${currentTenantId}: ${enqueue.error}`
        );
      }
    }

    let round = 0;
    while (true) {
      round += 1;
      const summary = await runInventoryEnrichmentWorker({
        workerId: `bulk-${currentTenantId}-${round}`,
        tenantId: currentTenantId,
        claimLimit: 5,
        runBudgetMs: 55_000,
        supabase,
      });

      console.log("[reprocess] worker round", {
        tenant_id: currentTenantId,
        round,
        claimed: summary.claimed,
        processed: summary.processed,
        outcomes: summary.outcomes,
        errors: summary.errors.length,
      });

      if (summary.errors.length > 0) {
        console.log("[reprocess] worker errors", summary.errors);
      }

      if (summary.claimed === 0) {
        break;
      }
    }
  }

  console.log("[reprocess] done", {
    tenants: grouped.size,
    rugs: rows.length,
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
