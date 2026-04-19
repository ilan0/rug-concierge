#!/usr/bin/env tsx

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { buildTradeTitle } from "../apps/web/lib/inventory/title-builder";

type RugRow = {
  id: string;
  tenant_id: string;
  stock_id: string | null;
  intake_label: string | null;
  status: string | null;
  enrichment_status: string | null;
  review_reason_code: string | null;
  width_total_in: number | null;
  length_total_in: number | null;
  ai_structured_fields: Record<string, unknown> | null;
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

function toObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return { ...(value as Record<string, unknown>) };
}

function withConfidenceBackfill(
  fields: Record<string, unknown> | null
): Record<string, unknown> | null {
  if (!fields) return null;
  const next = { ...fields };

  if (typeof next.origin === "string" && typeof next.origin_confidence !== "string") {
    next.origin_confidence = "medium";
  }
  if (typeof next.style === "string" && typeof next.style_confidence !== "string") {
    next.style_confidence = "medium";
  }

  return next;
}

async function main() {
  loadEnv();
  const { tenantId } = parseArgs(process.argv.slice(2));
  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false },
  });

  let query = supabase
    .from("rugs")
    .select(
      "id,tenant_id,stock_id,intake_label,status,enrichment_status,review_reason_code,width_total_in,length_total_in,ai_structured_fields"
    )
    .order("tenant_id", { ascending: true })
    .order("created_at", { ascending: true });

  if (tenantId) {
    query = query.eq("tenant_id", tenantId);
  }

  const { data, error } = await query;
  if (error || !Array.isArray(data)) {
    throw new Error(error?.message ?? "Unable to query rugs for reconciliation.");
  }

  const rows: RugRow[] = data.map((row) => ({
    id: typeof row.id === "string" ? row.id : "",
    tenant_id: typeof row.tenant_id === "string" ? row.tenant_id : "",
    stock_id: typeof row.stock_id === "string" ? row.stock_id : null,
    intake_label: typeof row.intake_label === "string" ? row.intake_label : null,
    status: typeof row.status === "string" ? row.status : null,
    enrichment_status:
      typeof row.enrichment_status === "string" ? row.enrichment_status : null,
    review_reason_code:
      typeof row.review_reason_code === "string" ? row.review_reason_code : null,
    width_total_in:
      typeof row.width_total_in === "number" ? row.width_total_in : null,
    length_total_in:
      typeof row.length_total_in === "number" ? row.length_total_in : null,
    ai_structured_fields: toObject(row.ai_structured_fields),
  }));

  let confidenceBackfills = 0;
  let recoveredReady = 0;

  for (const row of rows) {
    const aiFields = withConfidenceBackfill(row.ai_structured_fields);
    if (!aiFields) continue;

    const needsConfidenceBackfill =
      JSON.stringify(aiFields) !== JSON.stringify(row.ai_structured_fields);

    const deterministicTitle = buildTradeTitle({
      aiFields: aiFields as never,
      widthTotalIn: row.width_total_in,
      lengthTotalIn: row.length_total_in,
      fallbackLabel: row.intake_label,
    });

    const shouldRecoverReady =
      row.enrichment_status === "needs_review" &&
      row.review_reason_code === "ANALYSIS_INCOMPLETE" &&
      aiFields.is_rug === true &&
      typeof deterministicTitle === "string" &&
      deterministicTitle.trim().length > 0;

    if (!needsConfidenceBackfill && !shouldRecoverReady) {
      continue;
    }

    const payload: Record<string, unknown> = {
      ai_structured_fields: aiFields,
    };

    if (shouldRecoverReady) {
      payload.enrichment_status = "ready";
      payload.review_reason_code = null;
      payload.status = "available";
      payload.intake_label = deterministicTitle;
    }

    const update = await supabase
      .from("rugs")
      .update(payload)
      .eq("tenant_id", row.tenant_id)
      .eq("id", row.id);
    if (update.error) {
      throw new Error(
        `Unable to reconcile rug ${row.id} (${row.stock_id ?? "no-stock-id"}): ${update.error.message}`
      );
    }

    if (needsConfidenceBackfill) confidenceBackfills += 1;
    if (shouldRecoverReady) recoveredReady += 1;
  }

  console.log(
    JSON.stringify(
      {
        total_rows: rows.length,
        confidence_backfills: confidenceBackfills,
        recovered_ready: recoveredReady,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
