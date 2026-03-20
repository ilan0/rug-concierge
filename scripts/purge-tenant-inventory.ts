#!/usr/bin/env tsx

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const RUG_IMAGES_BUCKET = "rug-images";

type ScriptOptions = {
  tenantId: string;
  apply: boolean;
};

type TenantCounts = {
  rugs: number;
  rug_images: number;
  inventory_enrichment_jobs: number;
};

function loadEnvFile(filePath: string) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;

    const separator = line.indexOf("=");
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
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
  loadEnvFile(path.resolve(process.cwd(), ".env.local"));
  loadEnvFile(path.resolve(process.cwd(), "apps/web/.env.local"));
}

function printHelpAndExit(): never {
  console.log(
    [
      "Purge tenant inventory (rugs, images, enrichment jobs, and storage objects).",
      "",
      "Usage:",
      "  npx tsx scripts/purge-tenant-inventory.ts --tenant-id=<tenant> [--apply]",
      "",
      "Defaults:",
      "  Dry-run by default. Use --apply to execute deletes.",
    ].join("\n")
  );
  process.exit(0);
}

function parseArgs(argv: string[]): ScriptOptions {
  const options: ScriptOptions = {
    tenantId: "",
    apply: false,
  };

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      printHelpAndExit();
    }
    if (arg === "--apply") {
      options.apply = true;
      continue;
    }
    if (arg.startsWith("--tenant-id=")) {
      options.tenantId = arg.slice("--tenant-id=".length).trim();
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!options.tenantId) {
    options.tenantId = (process.env.TENANT_ID ?? "").trim();
  }
  if (!options.tenantId) {
    throw new Error("Missing --tenant-id=<tenant> (or TENANT_ID env var).");
  }

  return options;
}

function requireEnv(name: string): string {
  const value = (process.env[name] ?? "").trim();
  if (!value) throw new Error(`Missing ${name} environment variable.`);
  return value;
}

function requireAnyEnv(names: string[]): string {
  for (const name of names) {
    const value = (process.env[name] ?? "").trim();
    if (value) return value;
  }
  throw new Error(`Missing one of: ${names.join(", ")} environment variables.`);
}

async function fetchCount(input: {
  supabase: ReturnType<typeof createClient>;
  table: "rugs" | "rug_images" | "inventory_enrichment_jobs";
  tenantId: string;
}): Promise<number> {
  const result = await input.supabase
    .from(input.table)
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", input.tenantId);
  if (result.error) {
    throw new Error(
      `Failed to count ${input.table}: ${result.error.message ?? "unknown error"}`
    );
  }
  return result.count ?? 0;
}

async function fetchTenantCounts(input: {
  supabase: ReturnType<typeof createClient>;
  tenantId: string;
}): Promise<TenantCounts> {
  const [rugs, rugImages, jobs] = await Promise.all([
    fetchCount({ supabase: input.supabase, table: "rugs", tenantId: input.tenantId }),
    fetchCount({
      supabase: input.supabase,
      table: "rug_images",
      tenantId: input.tenantId,
    }),
    fetchCount({
      supabase: input.supabase,
      table: "inventory_enrichment_jobs",
      tenantId: input.tenantId,
    }),
  ]);

  return {
    rugs,
    rug_images: rugImages,
    inventory_enrichment_jobs: jobs,
  };
}

async function fetchTenantStoragePaths(input: {
  supabase: ReturnType<typeof createClient>;
  tenantId: string;
}): Promise<string[]> {
  const result = await input.supabase
    .from("rug_images")
    .select("path")
    .eq("tenant_id", input.tenantId);
  if (result.error || !Array.isArray(result.data)) {
    throw new Error(
      `Failed to load rug image paths: ${result.error?.message ?? "unknown error"}`
    );
  }

  return result.data
    .map((row) => (typeof row.path === "string" ? row.path.trim() : ""))
    .filter((value) => value.length > 0);
}

async function removeStoragePaths(input: {
  supabase: ReturnType<typeof createClient>;
  paths: string[];
}): Promise<void> {
  if (input.paths.length === 0) return;

  const chunkSize = 100;
  for (let i = 0; i < input.paths.length; i += chunkSize) {
    const slice = input.paths.slice(i, i + chunkSize);
    const result = await input.supabase.storage.from(RUG_IMAGES_BUCKET).remove(slice);
    if (result.error) {
      throw new Error(`Failed to remove storage objects: ${result.error.message}`);
    }
  }
}

async function applyPurge(input: {
  supabase: ReturnType<typeof createClient>;
  tenantId: string;
  storagePaths: string[];
}) {
  await removeStoragePaths({ supabase: input.supabase, paths: input.storagePaths });

  const rugsDelete = await input.supabase
    .from("rugs")
    .delete()
    .eq("tenant_id", input.tenantId);
  if (rugsDelete.error) {
    throw new Error(`Failed to delete rugs: ${rugsDelete.error.message}`);
  }

  const orphanImagesDelete = await input.supabase
    .from("rug_images")
    .delete()
    .eq("tenant_id", input.tenantId);
  if (orphanImagesDelete.error) {
    throw new Error(
      `Failed to delete remaining rug_images: ${orphanImagesDelete.error.message}`
    );
  }

  const jobsDelete = await input.supabase
    .from("inventory_enrichment_jobs")
    .delete()
    .eq("tenant_id", input.tenantId);
  if (jobsDelete.error) {
    throw new Error(
      `Failed to delete remaining inventory_enrichment_jobs: ${jobsDelete.error.message}`
    );
  }
}

async function main() {
  loadEnv();
  const options = parseArgs(process.argv.slice(2));

  const supabaseUrl = requireEnv("SUPABASE_URL");
  const supabaseKey = requireAnyEnv([
    "SUPABASE_SECRET_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
  ]);
  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
  });

  const before = await fetchTenantCounts({
    supabase,
    tenantId: options.tenantId,
  });
  const storagePaths = await fetchTenantStoragePaths({
    supabase,
    tenantId: options.tenantId,
  });

  if (options.apply) {
    await applyPurge({
      supabase,
      tenantId: options.tenantId,
      storagePaths,
    });
  }

  const after = await fetchTenantCounts({
    supabase,
    tenantId: options.tenantId,
  });

  const report = {
    generated_at: new Date().toISOString(),
    tenant_id: options.tenantId,
    apply: options.apply,
    storage_paths_found: storagePaths.length,
    before,
    after,
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
