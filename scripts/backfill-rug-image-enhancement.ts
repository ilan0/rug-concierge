#!/usr/bin/env tsx

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

type EnvMap = Record<string, string>;

type ScriptOptions = {
  tenantId: string | null;
  limit: number;
  dryRun: boolean;
};

type BackfillCandidate = {
  rug_id: string;
  tenant_id: string;
  enhancement_status: string | null;
  stock_id: string | null;
};

function loadEnv(): EnvMap {
  const env: EnvMap = {};
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
    env[line.slice(0, index)] = line.slice(index + 1).trim();
  }

  return env;
}

function parseArgs(argv: string[]): ScriptOptions {
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

  const parsedLimit = Number.parseInt(args.limit ?? "100", 10);
  return {
    tenantId: args["tenant-id"]?.trim() || null,
    limit: Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 100,
    dryRun: args["dry-run"] === "true",
  };
}

async function listCandidates(input: {
  supabase: ReturnType<typeof createClient>;
  tenantId: string | null;
  limit: number;
}): Promise<BackfillCandidate[]> {
  let query = input.supabase
    .from("rug_images")
    .select("rug_id, tenant_id, enhancement_status, rugs!inner(stock_id, status, enrichment_status)")
    .eq("rugs.status", "available")
    .eq("rugs.enrichment_status", "ready")
    .neq("enhancement_status", "ready")
    .order("created_at", { ascending: true })
    .limit(input.limit);

  if (input.tenantId) {
    query = query.eq("tenant_id", input.tenantId);
  }

  const result = await query;
  if (result.error || !Array.isArray(result.data)) {
    throw new Error(result.error?.message ?? "Unable to query enhancement backfill candidates.");
  }

  return result.data.flatMap((row) => {
    const rugId = typeof row.rug_id === "string" ? row.rug_id : null;
    const tenantId = typeof row.tenant_id === "string" ? row.tenant_id : null;
    if (!rugId || !tenantId) return [];

    const rugRecordRaw = Array.isArray(row.rugs) ? row.rugs[0] : row.rugs;
    const rugRecord =
      rugRecordRaw &&
      typeof rugRecordRaw === "object" &&
      !Array.isArray(rugRecordRaw)
        ? (rugRecordRaw as Record<string, unknown>)
        : null;

    return [
      {
        rug_id: rugId,
        tenant_id: tenantId,
        enhancement_status:
          typeof row.enhancement_status === "string" ? row.enhancement_status : null,
        stock_id:
          rugRecord && typeof rugRecord.stock_id === "string" ? rugRecord.stock_id : null,
      },
    ];
  });
}

async function main() {
  const env = loadEnv();
  for (const [key, value] of Object.entries(env)) {
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }

  const options = parseArgs(process.argv.slice(2));
  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const supabaseKey = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!supabaseUrl || !supabaseKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY are required.");
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
  });
  const { enhanceRugPrimaryImage } = await import(
    "../apps/web/lib/inventory/image-enhancement"
  );

  const candidates = await listCandidates({
    supabase,
    tenantId: options.tenantId,
    limit: options.limit,
  });

  if (options.dryRun) {
    console.log(
      JSON.stringify(
        {
          dry_run: true,
          count: candidates.length,
          rug_ids: candidates.map((candidate) => candidate.rug_id),
          tenant_ids: [...new Set(candidates.map((candidate) => candidate.tenant_id))],
        },
        null,
        2
      )
    );
    return;
  }

  const summary = {
    attempted: 0,
    succeeded: 0,
    failed: 0,
    failures: [] as Array<{ rug_id: string; tenant_id: string; error: string }>,
  };

  for (const candidate of candidates) {
    summary.attempted += 1;
    try {
      await enhanceRugPrimaryImage({
        supabase,
        tenantId: candidate.tenant_id,
        rugId: candidate.rug_id,
      });
      summary.succeeded += 1;
    } catch (error) {
      summary.failed += 1;
      summary.failures.push({
        rug_id: candidate.rug_id,
        tenant_id: candidate.tenant_id,
        error: error instanceof Error ? error.message : "Image enhancement failed.",
      });
    }
  }

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
