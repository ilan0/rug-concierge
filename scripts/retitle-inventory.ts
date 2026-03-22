#!/usr/bin/env tsx

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  buildTradeTitle,
  type TradeTitleAiFields,
} from "../apps/web/lib/inventory/title-builder";

type ScriptOptions = {
  tenantId: string;
  apply: boolean;
  limit: number | null;
};

type StaffOverrides = {
  label?: string | null;
};

type RugRow = {
  id: string;
  intake_label: string | null;
  ai_description: string | null;
  ai_structured_fields: TradeTitleAiFields | null;
  width_total_in: number | null;
  length_total_in: number | null;
  staff_overrides: StaffOverrides | null;
};

type PlannedChange = {
  id: string;
  from: string | null;
  to: string;
};

const FALLBACK_SENTINEL = "__FALLBACK_SENTINEL__";
const PREVIEW_LIMIT = 30;

function loadEnvFile(filePath: string) {
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
  loadEnvFile(path.resolve(process.cwd(), ".env.local"));
  loadEnvFile(path.resolve(process.cwd(), "apps/web/.env.local"));
}

function readTrimmedEnv(name: string): string | null {
  const value = process.env[name];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseArgs(argv: string[]): ScriptOptions {
  const options: ScriptOptions = {
    tenantId: "",
    apply: false,
    limit: null,
  };

  for (const arg of argv) {
    if (arg === "--apply") {
      options.apply = true;
      continue;
    }

    if (arg.startsWith("--tenant-id=")) {
      options.tenantId = arg.slice("--tenant-id=".length).trim();
      continue;
    }

    if (arg.startsWith("--limit=")) {
      const raw = arg.slice("--limit=".length).trim();
      const parsed = Number.parseInt(raw, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`Invalid --limit value: ${raw}`);
      }
      options.limit = parsed;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      printHelpAndExit();
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!options.tenantId) {
    const tenantIdFromEnv = readTrimmedEnv("TENANT_ID");
    if (tenantIdFromEnv) {
      options.tenantId = tenantIdFromEnv;
    }
  }
  if (!options.tenantId) {
    throw new Error("Missing --tenant-id=<uuid> (or TENANT_ID env var).");
  }

  return options;
}

function printHelpAndExit(): never {
  console.log(
    [
      "Retitle inventory rugs using deterministic trade naming.",
      "",
      "Usage:",
      "  npx tsx scripts/retitle-inventory.ts [--tenant-id=<uuid>] [--limit=<n>] [--apply]",
      "",
      "Defaults:",
      "  Dry-run by default (no writes).",
      "  Use --apply to persist updates.",
    ].join("\n")
  );
  process.exit(0);
}

function assertEnv(name: string): string {
  const value = readTrimmedEnv(name);
  if (!value) {
    throw new Error(`Missing ${name} environment variable.`);
  }
  return value;
}

function normalizeLabel(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function hasStaffLabelOverride(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const label = (value as Record<string, unknown>).label;
  return typeof label === "string" && label.trim().length > 0;
}

async function loadRugs(input: {
  supabase: ReturnType<typeof createClient>;
  tenantId: string;
  limit: number | null;
}): Promise<RugRow[]> {
  let query = input.supabase
    .from("rugs")
    .select(
      "id, intake_label, ai_description, ai_structured_fields, width_total_in, length_total_in, staff_overrides, created_at"
    )
    .eq("tenant_id", input.tenantId)
    .order("created_at", { ascending: true });

  if (typeof input.limit === "number") {
    query = query.limit(input.limit);
  }

  const { data, error } = await query;
  if (error || !Array.isArray(data)) {
    throw new Error(`Failed to load rugs: ${error?.message ?? "unknown error"}`);
  }

  return data.map((row) => ({
    id: typeof row.id === "string" ? row.id : "",
    intake_label:
      typeof row.intake_label === "string" ? row.intake_label : null,
    ai_description:
      typeof row.ai_description === "string" ? row.ai_description : null,
    ai_structured_fields:
      row.ai_structured_fields &&
      typeof row.ai_structured_fields === "object" &&
      !Array.isArray(row.ai_structured_fields)
        ? (row.ai_structured_fields as TradeTitleAiFields)
        : null,
    width_total_in:
      typeof row.width_total_in === "number" ? row.width_total_in : null,
    length_total_in:
      typeof row.length_total_in === "number" ? row.length_total_in : null,
    staff_overrides:
      row.staff_overrides &&
      typeof row.staff_overrides === "object" &&
      !Array.isArray(row.staff_overrides)
        ? (row.staff_overrides as StaffOverrides)
        : null,
  }));
}

async function applyChanges(input: {
  supabase: ReturnType<typeof createClient>;
  tenantId: string;
  changes: PlannedChange[];
}): Promise<{ applied: number; failed: number; failures: string[] }> {
  let applied = 0;
  let failed = 0;
  const failures: string[] = [];

  for (const change of input.changes) {
    const result = await input.supabase
      .from("rugs")
      .update({ intake_label: change.to })
      .eq("tenant_id", input.tenantId)
      .eq("id", change.id);

    if (result.error) {
      failed += 1;
      failures.push(`${change.id}: ${result.error.message}`);
      continue;
    }
    applied += 1;
  }

  return { applied, failed, failures };
}

async function main() {
  loadEnv();
  const options = parseArgs(process.argv.slice(2));

  const supabaseUrl = assertEnv("SUPABASE_URL");
  const supabaseKey = assertEnv("SUPABASE_SECRET_KEY");

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
  });

  const rugs = await loadRugs({
    supabase,
    tenantId: options.tenantId,
    limit: options.limit,
  });

  const changes: PlannedChange[] = [];
  let skippedStaffOverride = 0;
  let fallbackCount = 0;
  let unchangedCount = 0;

  for (const rug of rugs) {
    if (!rug.id) continue;
    if (hasStaffLabelOverride(rug.staff_overrides)) {
      skippedStaffOverride += 1;
      continue;
    }

    const fallbackProbe = buildTradeTitle({
      aiFields: rug.ai_structured_fields,
      widthTotalIn: rug.width_total_in,
      lengthTotalIn: rug.length_total_in,
      fallbackLabel: FALLBACK_SENTINEL,
      aiDescription: rug.ai_description,
    });
    if (fallbackProbe === FALLBACK_SENTINEL) {
      fallbackCount += 1;
    }

    const nextLabel = buildTradeTitle({
      aiFields: rug.ai_structured_fields,
      widthTotalIn: rug.width_total_in,
      lengthTotalIn: rug.length_total_in,
      fallbackLabel: rug.intake_label,
      aiDescription: rug.ai_description,
    });
    const current = normalizeLabel(rug.intake_label);
    const next = normalizeLabel(nextLabel);

    if (!next || next === current) {
      unchangedCount += 1;
      continue;
    }

    changes.push({
      id: rug.id,
      from: current,
      to: next,
    });
  }

  const summaryBase = {
    mode: options.apply ? "apply" : "dry-run",
    tenantId: options.tenantId,
    totalRows: rugs.length,
    skippedStaffOverride,
    fallbackCount,
    unchangedCount,
    pendingChanges: changes.length,
  };

  if (!options.apply) {
    console.log(
      JSON.stringify(
        {
          ...summaryBase,
          preview: changes.slice(0, PREVIEW_LIMIT),
        },
        null,
        2
      )
    );
    return;
  }

  const applied = await applyChanges({
    supabase,
    tenantId: options.tenantId,
    changes,
  });
  console.log(
    JSON.stringify(
      {
        ...summaryBase,
        applied: applied.applied,
        failed: applied.failed,
        failures: applied.failures.slice(0, PREVIEW_LIMIT),
      },
      null,
      2
    )
  );
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
