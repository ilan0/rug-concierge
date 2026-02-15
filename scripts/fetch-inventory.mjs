#!/usr/bin/env node

import { createClient } from "@supabase/supabase-js";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

function readArg(flag, fallback = null) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !supabaseSecretKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SECRET_KEY");
  }

  const tenantId = readArg("--tenant", "");
  const limit = Number.parseInt(readArg("--limit", "300"), 10);
  const outFile = readArg(
    "--out",
    "docs/testing/fixtures/inventory-snapshot.json"
  );

  const supabase = createClient(supabaseUrl, supabaseSecretKey, {
    auth: { persistSession: false },
  });

  let query = supabase
    .from("rugs")
    .select(
      "id, tenant_id, sku, intake_label, status, price, sale_price, width_total_in, length_total_in, style, palette, pattern, best_for, public_description"
    )
    .order("id", { ascending: true })
    .limit(Number.isFinite(limit) ? limit : 300);

  if (tenantId) {
    query = query.eq("tenant_id", tenantId);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Supabase query failed: ${error.message}`);
  }

  const payload = {
    generated_at: new Date().toISOString(),
    tenant_id: tenantId || null,
    row_count: data?.length ?? 0,
    rows: data ?? [],
  };

  const outputPath = path.resolve(process.cwd(), outFile);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(payload, null, 2), "utf8");

  console.log(`Inventory snapshot written to ${outputPath}`);
  console.log(`Rows: ${payload.row_count}`);
}

main().catch((error) => {
  const details = error instanceof Error ? error.message : String(error);
  console.error("[fetch-inventory] Failed:", details);
  process.exit(1);
});

