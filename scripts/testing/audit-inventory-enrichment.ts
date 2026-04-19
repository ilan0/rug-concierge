#!/usr/bin/env tsx

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

type AuditRow = {
  tenant_id: string;
  id: string;
  stock_id: string | null;
  intake_label: string | null;
  status: string | null;
  enrichment_status: string | null;
  review_reason_code: string | null;
  ai_description: string | null;
  ai_structured_fields: Record<string, unknown> | null;
};

function loadEnv() {
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
    outPath:
      args["out"] ??
      "tmp/qa/inventory-enrichment-audit.json",
  };
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function auditRow(row: AuditRow): string[] {
  const issues: string[] = [];
  const fields = row.ai_structured_fields ?? {};
  const label = typeof row.intake_label === "string" ? row.intake_label.trim() : "";
  const description =
    typeof row.ai_description === "string" ? row.ai_description.trim() : "";

  if (row.enrichment_status !== "ready") {
    issues.push(`enrichment_status=${row.enrichment_status ?? "null"}`);
  }
  if (row.status !== "available") {
    issues.push(`status=${row.status ?? "null"}`);
  }
  if (row.review_reason_code) {
    issues.push(`review_reason_code=${row.review_reason_code}`);
  }
  if (!label) {
    issues.push("missing_label");
  }
  if (!description) {
    issues.push("missing_description");
  }
  if (!fields || Object.keys(fields).length === 0) {
    issues.push("missing_ai_fields");
    return issues;
  }

  const mood = typeof fields.mood === "string" ? fields.mood : null;
  const colors = toStringArray(fields.primary_colors);
  const pattern = toStringArray(fields.pattern);
  const isRug = typeof fields.is_rug === "boolean" ? fields.is_rug : null;
  const rugConfidence =
    typeof fields.is_rug_confidence === "string" ? fields.is_rug_confidence : null;
  const origin = typeof fields.origin === "string" ? fields.origin : null;
  const originConfidence =
    typeof fields.origin_confidence === "string" ? fields.origin_confidence : null;
  const style = typeof fields.style === "string" ? fields.style : null;
  const styleConfidence =
    typeof fields.style_confidence === "string" ? fields.style_confidence : null;

  if (!mood) issues.push("missing_mood");
  if (colors.length === 0) issues.push("missing_primary_colors");
  if (pattern.length === 0) issues.push("missing_pattern");
  if (isRug !== true) issues.push(`is_rug=${String(isRug)}`);
  if (!rugConfidence) issues.push("missing_is_rug_confidence");
  if (origin && !originConfidence) issues.push("missing_origin_confidence");
  if (style && !styleConfidence) issues.push("missing_style_confidence");

  return issues;
}

async function main() {
  loadEnv();
  const { tenantId, outPath } = parseArgs(process.argv.slice(2));
  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false },
  });

  let query = supabase
    .from("rugs")
    .select(
      "tenant_id,id,stock_id,intake_label,status,enrichment_status,review_reason_code,ai_description,ai_structured_fields"
    )
    .order("tenant_id", { ascending: true })
    .order("created_at", { ascending: true });
  if (tenantId) {
    query = query.eq("tenant_id", tenantId);
  }

  const { data, error } = await query;
  if (error || !Array.isArray(data)) {
    throw new Error(error?.message ?? "Unable to query rugs for audit.");
  }

  const rows: AuditRow[] = data.map((row) => ({
    tenant_id: typeof row.tenant_id === "string" ? row.tenant_id : "",
    id: typeof row.id === "string" ? row.id : "",
    stock_id: typeof row.stock_id === "string" ? row.stock_id : null,
    intake_label: typeof row.intake_label === "string" ? row.intake_label : null,
    status: typeof row.status === "string" ? row.status : null,
    enrichment_status:
      typeof row.enrichment_status === "string" ? row.enrichment_status : null,
    review_reason_code:
      typeof row.review_reason_code === "string" ? row.review_reason_code : null,
    ai_description:
      typeof row.ai_description === "string" ? row.ai_description : null,
    ai_structured_fields:
      row.ai_structured_fields &&
      typeof row.ai_structured_fields === "object" &&
      !Array.isArray(row.ai_structured_fields)
        ? (row.ai_structured_fields as Record<string, unknown>)
        : null,
  }));

  const results = rows.map((row) => ({
    ...row,
    issues: auditRow(row),
  }));
  const failing = results.filter((row) => row.issues.length > 0);

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        total: results.length,
        passing: results.length - failing.length,
        failing: failing.length,
        rows: results,
      },
      null,
      2
    )
  );

  console.log(
    JSON.stringify(
      {
        total: results.length,
        failing: failing.length,
        report: outPath,
        sample_failures: failing.slice(0, 20).map((row) => ({
          tenant_id: row.tenant_id,
          stock_id: row.stock_id,
          id: row.id,
          issues: row.issues,
        })),
      },
      null,
      2
    )
  );

  if (failing.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
