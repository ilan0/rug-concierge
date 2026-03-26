#!/usr/bin/env tsx

import fs from "node:fs";
import path from "node:path";
import { chromium, type Page } from "playwright";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type DatasetRecord = {
  sequence: number;
  stock_id: string;
  display_name: string;
  origin: string;
  style: string;
  condition: "excellent" | "good" | "fair" | "notable_wear";
  age_category: "antique" | "semi-antique" | "vintage" | "new";
  dominant_color:
    | "blue"
    | "green"
    | "ivory"
    | "red"
    | "rust"
    | "gold"
    | "brown"
    | "multi"
    | "navy"
    | "teal"
    | "black"
    | "gray";
  width_ft: number;
  width_in: number;
  length_ft: number;
  length_in: number;
  shape: "area" | "runner" | "round" | "oval";
  expected_keywords: string[];
  image: {
    local_path: string;
    source: "wikimedia" | "met";
    source_url: string;
    source_title: string;
    bytes: number;
    sha256: string;
  };
};

type TenantRow = {
  id: string;
  settings: unknown;
  secrets: unknown;
};

type RugRow = {
  id: string;
  stock_id: string | null;
  status: string | null;
  width_total_in: number | null;
  length_total_in: number | null;
  ai_description: string | null;
  ai_structured_fields: Record<string, unknown> | null;
  enrichment_status: string | null;
  created_at: string | null;
};

type BatchStopReason =
  | "enrichment_silent_failure"
  | "image_storage_failure"
  | "persistence_failure"
  | "size_parsing_failure"
  | "color_extraction_failure"
  | "form_regression"
  | "cost_signal";

type BatchVerificationResult = {
  batch_index: number;
  stock_ids: string[];
  submitted: number;
  found_in_db: number;
  passed: number;
  issues: string[];
  checks: {
    name_present_count: number;
    size_mismatch_count: number;
    image_missing_count: number;
    image_broken_count: number;
    ai_description_empty_count: number;
    color_empty_count: number;
    available_true_count: number;
    duplicate_id_count: number;
    plausibility_spot_checks: Array<{
      stock_id: string;
      passed: boolean;
      note: string;
    }>;
  };
  should_stop: boolean;
  stop_reason: BatchStopReason | null;
  stop_records: Array<Record<string, unknown>>;
};

type RunSummary = {
  run_started_at: string;
  run_finished_at: string | null;
  host: string;
  tenant_id: string;
  tenant_subdomain: string;
  dataset_path: string;
  total_requested: number;
  total_submitted: number;
  total_batches_completed: number;
  stopped: boolean;
  stop_reason: BatchStopReason | null;
  stop_batch: number | null;
  batch_results: BatchVerificationResult[];
  successful_stock_ids: string[];
};

const DEFAULT_BATCH_SIZE = 25;
const DB_APPEAR_TIMEOUT_MS = 30_000;
const DB_POLL_INTERVAL_MS = 1_500;
const ENRICHMENT_WAIT_MS = 12 * 60_000;
const ENRICHMENT_POLL_MS = 15_000;
const INTAKE_WRITE_WINDOW_MS = 10 * 60_000;
const INTAKE_WRITE_MAX_REQUESTS = 28;

function parseArgs() {
  const args = process.argv.slice(2);
  const out: Record<string, string> = {};
  for (const arg of args) {
    if (!arg.startsWith("--")) continue;
    const idx = arg.indexOf("=");
    if (idx === -1) {
      out[arg.slice(2)] = "true";
      continue;
    }
    out[arg.slice(2, idx)] = arg.slice(idx + 1);
  }
  return out;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadEnvFileIfExists(filePath: string) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf8");
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
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

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function loadEnv() {
  const cwd = process.cwd();
  loadEnvFileIfExists(path.join(cwd, ".env.local"));
  loadEnvFileIfExists(path.join(cwd, "apps/web/.env.local"));
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value.trim();
}

function normalizeHostname(value: string): string {
  try {
    const host = new URL(value).hostname;
    return host.trim().toLowerCase();
  } catch {
    return value.trim().toLowerCase();
  }
}

function parseSubdomain(hostOrUrl: string): string {
  const hostname = normalizeHostname(hostOrUrl);
  const labels = hostname.split(".").filter(Boolean);
  if (labels.length < 3) {
    throw new Error(`Expected a subdomain hostname, got: ${hostname}`);
  }
  return labels[0] ?? "";
}

function aliasesFromSettings(settings: unknown): string[] {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return [];
  const row = settings as Record<string, unknown>;
  const aliases = new Set<string>();

  const push = (value: unknown) => {
    if (typeof value !== "string") return;
    const normalized = value.trim().toLowerCase();
    if (!normalized) return;
    aliases.add(normalized);
  };

  push(row.subdomain);
  push(row.store_subdomain);
  push(row.domain_subdomain);

  const domains = row.domains;
  if (Array.isArray(domains)) {
    for (const entry of domains) {
      if (typeof entry === "string") {
        const host = normalizeHostname(entry);
        const sub = host.split(".")[0];
        if (sub) push(sub);
        continue;
      }
      if (entry && typeof entry === "object") {
        const typed = entry as Record<string, unknown>;
        push(typed.subdomain);
        if (typeof typed.host === "string") {
          const host = normalizeHostname(typed.host);
          const sub = host.split(".")[0];
          if (sub) push(sub);
        }
      }
    }
  }

  return [...aliases];
}

async function resolveTenant(input: {
  supabase: SupabaseClient;
  subdomain: string;
}): Promise<{ tenantId: string; passcode: string }> {
  const { data, error } = await input.supabase
    .from("tenants")
    .select("id, settings, secrets");

  if (error || !Array.isArray(data)) {
    throw new Error(`Unable to query tenants: ${error?.message ?? "unknown error"}`);
  }

  const normalizedSubdomain = input.subdomain.trim().toLowerCase();
  for (const row of data) {
    const typed = row as TenantRow;
    if (typeof typed.id !== "string" || !typed.id.trim()) continue;

    const aliases = aliasesFromSettings(typed.settings);
    if (!aliases.includes(normalizedSubdomain)) continue;

    const secrets =
      typed.secrets && typeof typed.secrets === "object" && !Array.isArray(typed.secrets)
        ? (typed.secrets as Record<string, unknown>)
        : {};
    const passcode =
      typeof secrets.store_passcode === "string" ? secrets.store_passcode.trim() : "";

    if (!passcode) {
      throw new Error(`Tenant ${typed.id} resolved but has no store_passcode in tenants.secrets.`);
    }

    return {
      tenantId: typed.id,
      passcode,
    };
  }

  throw new Error(`Could not resolve tenant for subdomain: ${normalizedSubdomain}`);
}

function readDataset(datasetPath: string): DatasetRecord[] {
  if (!fs.existsSync(datasetPath)) {
    throw new Error(`Dataset not found: ${datasetPath}`);
  }

  const payload = JSON.parse(fs.readFileSync(datasetPath, "utf8")) as unknown;
  if (!Array.isArray(payload)) {
    throw new Error("Dataset must be a JSON array.");
  }

  const rows: DatasetRecord[] = [];
  for (const item of payload) {
    if (!item || typeof item !== "object") continue;
    const row = item as DatasetRecord;
    if (typeof row.stock_id !== "string") continue;
    if (!row.image || typeof row.image.local_path !== "string") continue;

    const imagePath = path.resolve(row.image.local_path);
    if (!fs.existsSync(imagePath)) {
      throw new Error(`Image file missing for ${row.stock_id}: ${imagePath}`);
    }

    row.image.local_path = imagePath;
    rows.push(row);
  }

  if (rows.length === 0) {
    throw new Error("Dataset contains no usable rows.");
  }

  return rows;
}

async function unlockStaffMode(input: {
  page: Page;
  host: string;
  passcode: string;
}) {
  const { page, host, passcode } = input;

  await page.goto(`${host}/intake`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => null);

  if (page.url().includes("/intake")) {
    const heading = page.getByRole("heading", { name: "Inventory Intake" });
    if (await heading.isVisible().catch(() => false)) return;
  }

  const unlockButton = page.getByRole("button", { name: "Unlock staff mode" });
  if (!(await unlockButton.isVisible().catch(() => false))) {
    await page.goto(`${host}/concierge`, { waitUntil: "domcontentloaded" });
  }

  if (await unlockButton.isVisible().catch(() => false)) {
    await unlockButton.click();
  }

  await page.getByRole("dialog", { name: "Staff Access" }).waitFor({ timeout: 10_000 });

  for (const digit of passcode.split("")) {
    await page.getByRole("button", { name: digit, exact: true }).click();
    await sleep(80);
  }

  await page.waitForURL(/\/(inventory|intake)/, { timeout: 15_000 });
  if (!page.url().includes("/intake")) {
    await page.goto(`${host}/intake`, { waitUntil: "domcontentloaded" });
  }

  await page.getByRole("heading", { name: "Inventory Intake" }).waitFor({ timeout: 15_000 });
}

async function submitSingleRug(input: {
  page: Page;
  row: DatasetRecord;
}): Promise<{ ok: boolean; latencyMs: number; status: number | null; error: string | null }> {
  const startedAt = Date.now();

  const singleTab = input.page.getByRole("button", { name: "Single" });
  if (await singleTab.isVisible().catch(() => false)) {
    await singleTab.click();
  }

  const form = input.page.locator("form").first();
  const fileInput = form.locator('input[type="file"]').first();
  await fileInput.setInputFiles(input.row.image.local_path);

  const dims = form.locator('input[placeholder="0"]');
  const count = await dims.count();
  if (count < 4) {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      status: null,
      error: `Expected 4 dimension fields, found ${count}`,
    };
  }

  await dims.nth(0).fill(String(input.row.width_ft));
  await dims.nth(1).fill(String(input.row.width_in));
  await dims.nth(2).fill(String(input.row.length_ft));
  await dims.nth(3).fill(String(input.row.length_in));

  await form.getByPlaceholder("e.g. HER-1082").fill(input.row.stock_id);

  const responsePromise = input.page.waitForResponse(
    (resp) =>
      resp.url().includes("/api/inventory/intake") &&
      resp.request().method().toUpperCase() === "POST",
    { timeout: 90_000 }
  );

  await form.getByRole("button", { name: "Add to inventory" }).click();

  let status: number | null = null;
  try {
    const response = await responsePromise;
    status = response.status();
    if (!response.ok()) {
      const text = await response.text().catch(() => "");
      return {
        ok: false,
        latencyMs: Date.now() - startedAt,
        status,
        error: text.slice(0, 500),
      };
    }
  } catch (error) {
    const noticeVisible = await input.page
      .getByText("Rug saved. AI enrichment is running in the background.")
      .isVisible()
      .catch(() => false);
    if (noticeVisible) {
      return {
        ok: true,
        latencyMs: Date.now() - startedAt,
        status: 200,
        error: null,
      };
    }
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      status: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  await input.page
    .getByText("Rug saved. AI enrichment is running in the background.")
    .waitFor({ timeout: 15_000 })
    .catch(() => null);

  return {
    ok: true,
    latencyMs: Date.now() - startedAt,
    status,
    error: null,
  };
}

async function fetchBatchRows(input: {
  supabase: SupabaseClient;
  tenantId: string;
  stockIds: string[];
}) {
  const rugsQuery = await input.supabase
    .from("rugs")
    .select(
      "id, stock_id, status, width_total_in, length_total_in, ai_description, ai_structured_fields, enrichment_status, created_at"
    )
    .eq("tenant_id", input.tenantId)
    .in("stock_id", input.stockIds);

  if (rugsQuery.error || !Array.isArray(rugsQuery.data)) {
    throw new Error(`Failed to query rugs for verification: ${rugsQuery.error?.message ?? "unknown error"}`);
  }

  const rugs: RugRow[] = rugsQuery.data.map((row) => {
    const typed = row as Record<string, unknown>;
    return {
      id: typeof typed.id === "string" ? typed.id : "",
      stock_id: typeof typed.stock_id === "string" ? typed.stock_id : null,
      status: typeof typed.status === "string" ? typed.status : null,
      width_total_in:
        typeof typed.width_total_in === "number" ? typed.width_total_in : null,
      length_total_in:
        typeof typed.length_total_in === "number" ? typed.length_total_in : null,
      ai_description:
        typeof typed.ai_description === "string" ? typed.ai_description : null,
      ai_structured_fields:
        typed.ai_structured_fields &&
        typeof typed.ai_structured_fields === "object" &&
        !Array.isArray(typed.ai_structured_fields)
          ? (typed.ai_structured_fields as Record<string, unknown>)
          : null,
      enrichment_status:
        typeof typed.enrichment_status === "string" ? typed.enrichment_status : null,
      created_at: typeof typed.created_at === "string" ? typed.created_at : null,
    };
  });

  const rugIds = rugs.map((row) => row.id).filter((id) => id.length > 0);
  const imageMap = new Map<string, string | null>();

  if (rugIds.length > 0) {
    const imageQuery = await input.supabase
      .from("rug_images")
      .select("rug_id, path")
      .eq("tenant_id", input.tenantId)
      .in("rug_id", rugIds);

    if (!imageQuery.error && Array.isArray(imageQuery.data)) {
      for (const row of imageQuery.data) {
        const typed = row as Record<string, unknown>;
        const rugId = typeof typed.rug_id === "string" ? typed.rug_id : "";
        if (!rugId || imageMap.has(rugId)) continue;

        const rawPath = typeof typed.path === "string" ? typed.path.trim().replace(/^\/+/, "") : "";
        if (!rawPath) {
          imageMap.set(rugId, null);
          continue;
        }

        const { data } = input.supabase.storage.from("rug-images").getPublicUrl(rawPath);
        const url = data?.publicUrl && typeof data.publicUrl === "string" ? data.publicUrl : null;
        imageMap.set(rugId, url);
      }
    }
  }

  return { rugs, imageMap };
}

async function isImageUrlReachable(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const head = await fetch(url, { method: "HEAD", signal: controller.signal });
    if (head.ok) return true;
    const get = await fetch(url, { method: "GET", signal: controller.signal });
    return get.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function extractPrimaryColors(fields: Record<string, unknown> | null): string[] {
  if (!fields) return [];
  const value = fields.primary_colors;
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function isDescriptionPlausible(input: {
  row: RugRow;
  datasetRow: DatasetRecord;
}): { passed: boolean; note: string } {
  const description = `${input.row.ai_description ?? ""}`.toLowerCase();
  const label = "";
  const corpus = `${description} ${label}`;

  if (corpus.trim().length === 0) {
    return { passed: false, note: "Empty AI description." };
  }

  const keywordHits = input.datasetRow.expected_keywords.filter((keyword) =>
    corpus.includes(keyword.toLowerCase())
  );

  if (keywordHits.length > 0) {
    return {
      passed: true,
      note: `Matched keywords: ${keywordHits.join(", ")}`,
    };
  }

  return {
    passed: false,
    note: "No expected keyword match in description.",
  };
}

async function verifyBatch(input: {
  supabase: SupabaseClient;
  tenantId: string;
  batchIndex: number;
  batchRows: DatasetRecord[];
  cronKickUrl?: string | null;
}): Promise<BatchVerificationResult> {
  if (input.batchRows.length === 0) {
    return {
      batch_index: input.batchIndex,
      stock_ids: [],
      submitted: 0,
      found_in_db: 0,
      passed: 0,
      issues: ["No successful submissions in this batch."],
      checks: {
        name_present_count: 0,
        size_mismatch_count: 0,
        image_missing_count: 0,
        image_broken_count: 0,
        ai_description_empty_count: 0,
        color_empty_count: 0,
        available_true_count: 0,
        duplicate_id_count: 0,
        plausibility_spot_checks: [],
      },
      should_stop: false,
      stop_reason: null,
      stop_records: [],
    };
  }

  const stockIds = input.batchRows.map((row) => row.stock_id);
  const byStockId = new Map(input.batchRows.map((row) => [row.stock_id, row]));

  const started = Date.now();
  let rugs: RugRow[] = [];
  let imageMap = new Map<string, string | null>();

  while (Date.now() - started <= DB_APPEAR_TIMEOUT_MS) {
    const fetched = await fetchBatchRows({
      supabase: input.supabase,
      tenantId: input.tenantId,
      stockIds,
    });
    rugs = fetched.rugs;
    imageMap = fetched.imageMap;

    const present = new Set(
      rugs
        .map((row) => row.stock_id)
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    );

    const missing = stockIds.filter((id) => !present.has(id));
    if (missing.length === 0) break;

    await sleep(DB_POLL_INTERVAL_MS);
  }

  const present = new Set(
    rugs
      .map((row) => row.stock_id)
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
  );
  const missingAfterTimeout = stockIds.filter((id) => !present.has(id));

  if (missingAfterTimeout.length > 0) {
    return {
      batch_index: input.batchIndex,
      stock_ids: stockIds,
      submitted: stockIds.length,
      found_in_db: rugs.length,
      passed: 0,
      issues: [`Persistence failure: missing ${missingAfterTimeout.length} submitted rugs after 30s.`],
      checks: {
        name_present_count: 0,
        size_mismatch_count: 0,
        image_missing_count: 0,
        image_broken_count: 0,
        ai_description_empty_count: 0,
        color_empty_count: 0,
        available_true_count: 0,
        duplicate_id_count: 0,
        plausibility_spot_checks: [],
      },
      should_stop: true,
      stop_reason: "persistence_failure",
      stop_records: missingAfterTimeout.map((stockId) => ({ stock_id: stockId })),
    };
  }

  const enrichStart = Date.now();
  while (Date.now() - enrichStart <= ENRICHMENT_WAIT_MS) {
    if (input.cronKickUrl && input.cronKickUrl.trim().length > 0) {
      await fetch(input.cronKickUrl, {
        method: "GET",
        headers: {
          "x-vercel-cron": "1",
        },
      }).catch(() => null);
    }

    const fetched = await fetchBatchRows({
      supabase: input.supabase,
      tenantId: input.tenantId,
      stockIds,
    });
    rugs = fetched.rugs;
    imageMap = fetched.imageMap;

    const emptyDescriptionCount = rugs.filter(
      (row) => !row.ai_description || row.ai_description.trim().length === 0
    ).length;

    const emptyColorCount = rugs.filter((row) => {
      if (!row.ai_description || row.ai_description.trim().length === 0) return false;
      return extractPrimaryColors(row.ai_structured_fields).length === 0;
    }).length;

    if (emptyDescriptionCount <= 3 && emptyColorCount <= 5) {
      break;
    }

    await sleep(ENRICHMENT_POLL_MS);
  }

  const idSet = new Set<string>();
  let duplicateIdCount = 0;
  for (const row of rugs) {
    if (!row.id) continue;
    if (idSet.has(row.id)) {
      duplicateIdCount += 1;
    }
    idSet.add(row.id);
  }

  let namePresentCount = 0;
  let sizeMismatchCount = 0;
  let imageMissingCount = 0;
  let imageBrokenCount = 0;
  let aiDescriptionEmptyCount = 0;
  let colorEmptyCount = 0;
  let availableTrueCount = 0;
  const issues: string[] = [];

  const brokenImageRecords: Array<Record<string, unknown>> = [];
  const missingImageRecords: Array<Record<string, unknown>> = [];
  const sizeMismatchRecords: Array<Record<string, unknown>> = [];

  for (const row of rugs) {
    const stockId = row.stock_id ?? "";
    const datasetRow = byStockId.get(stockId);
    if (!datasetRow) continue;

    if (row.ai_description && row.ai_description.trim().length > 0) {
      namePresentCount += 1;
    } else {
      aiDescriptionEmptyCount += 1;
    }

    const expectedWidth = datasetRow.width_ft * 12 + datasetRow.width_in;
    const expectedLength = datasetRow.length_ft * 12 + datasetRow.length_in;
    if (row.width_total_in !== expectedWidth || row.length_total_in !== expectedLength) {
      sizeMismatchCount += 1;
      sizeMismatchRecords.push({
        stock_id: stockId,
        expected_width_total_in: expectedWidth,
        expected_length_total_in: expectedLength,
        actual_width_total_in: row.width_total_in,
        actual_length_total_in: row.length_total_in,
      });
    }

    const imageUrl = imageMap.get(row.id) ?? null;
    if (!imageUrl) {
      imageMissingCount += 1;
      missingImageRecords.push({ stock_id: stockId, rug_id: row.id });
    } else {
      const reachable = await isImageUrlReachable(imageUrl);
      if (!reachable) {
        imageBrokenCount += 1;
        brokenImageRecords.push({ stock_id: stockId, rug_id: row.id, image_url: imageUrl });
      }
    }

    if (row.status === "available") {
      availableTrueCount += 1;
    }

    if (row.ai_description && row.ai_description.trim().length > 0) {
      const colors = extractPrimaryColors(row.ai_structured_fields);
      if (colors.length === 0) {
        colorEmptyCount += 1;
      }
    }
  }

  const plausibilityRows = rugs
    .filter((row) => row.stock_id && byStockId.has(row.stock_id) && row.ai_description)
    .slice(0, 5);

  const plausibilitySpotChecks = plausibilityRows.map((row) => {
    const datasetRow = byStockId.get(row.stock_id ?? "") as DatasetRecord;
    const result = isDescriptionPlausible({ row, datasetRow });
    return {
      stock_id: row.stock_id ?? "",
      passed: result.passed,
      note: result.note,
    };
  });

  if (imageMissingCount > 0) {
    issues.push(`Image missing count: ${imageMissingCount}`);
  }
  if (imageBrokenCount > 0) {
    issues.push(`Image broken count: ${imageBrokenCount}`);
  }
  if (sizeMismatchCount > 0) {
    issues.push(`Size mismatch count: ${sizeMismatchCount}`);
  }
  if (aiDescriptionEmptyCount > 0) {
    issues.push(`AI description empty count: ${aiDescriptionEmptyCount}`);
  }
  if (colorEmptyCount > 0) {
    issues.push(`AI primary_colors empty count: ${colorEmptyCount}`);
  }
  if (duplicateIdCount > 0) {
    issues.push(`Duplicate ID count: ${duplicateIdCount}`);
  }

  let shouldStop = false;
  let stopReason: BatchStopReason | null = null;
  const stopRecords: Array<Record<string, unknown>> = [];

  if (aiDescriptionEmptyCount > 3) {
    shouldStop = true;
    stopReason = "enrichment_silent_failure";
    stopRecords.push(
      ...rugs
        .filter((row) => !row.ai_description || row.ai_description.trim().length === 0)
        .slice(0, 10)
        .map((row) => ({
          stock_id: row.stock_id,
          rug_id: row.id,
          enrichment_status: row.enrichment_status,
          ai_description: row.ai_description,
        }))
    );
  } else if (imageMissingCount + imageBrokenCount > 3) {
    shouldStop = true;
    stopReason = "image_storage_failure";
    stopRecords.push(...missingImageRecords.slice(0, 10), ...brokenImageRecords.slice(0, 10));
  } else if (sizeMismatchCount > 5) {
    shouldStop = true;
    stopReason = "size_parsing_failure";
    stopRecords.push(...sizeMismatchRecords.slice(0, 10));
  } else if (colorEmptyCount > 5) {
    shouldStop = true;
    stopReason = "color_extraction_failure";
    stopRecords.push(
      ...rugs
        .filter((row) => {
          if (!row.ai_description || row.ai_description.trim().length === 0) return false;
          return extractPrimaryColors(row.ai_structured_fields).length === 0;
        })
        .slice(0, 10)
        .map((row) => ({
          stock_id: row.stock_id,
          rug_id: row.id,
          ai_structured_fields: row.ai_structured_fields,
        }))
    );
  }

  const passed = stockIds.length - issues.length;

  return {
    batch_index: input.batchIndex,
    stock_ids: stockIds,
    submitted: stockIds.length,
    found_in_db: rugs.length,
    passed,
    issues,
    checks: {
      name_present_count: namePresentCount,
      size_mismatch_count: sizeMismatchCount,
      image_missing_count: imageMissingCount,
      image_broken_count: imageBrokenCount,
      ai_description_empty_count: aiDescriptionEmptyCount,
      color_empty_count: colorEmptyCount,
      available_true_count: availableTrueCount,
      duplicate_id_count: duplicateIdCount,
      plausibility_spot_checks: plausibilitySpotChecks,
    },
    should_stop: shouldStop,
    stop_reason: stopReason,
    stop_records: stopRecords,
  };
}

function countBy<T extends string>(values: T[]): Record<string, number> {
  const map = new Map<string, number>();
  for (const value of values) {
    map.set(value, (map.get(value) ?? 0) + 1);
  }
  return Object.fromEntries([...map.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}

async function writeReport(input: {
  outputDir: string;
  summary: RunSummary;
  successfulRows: DatasetRecord[];
}) {
  const reportPath = path.join(input.outputDir, "run-report.json");
  const onePagerPath = path.join(input.outputDir, "run-report.md");

  const byOrigin = countBy(input.successfulRows.map((row) => row.origin));
  const byColor = countBy(input.successfulRows.map((row) => row.dominant_color));

  const sizeBands = input.successfulRows.map((row) => {
    if (row.shape === "runner") return "runner";
    if (row.shape === "round" || row.shape === "oval") return "odd/specialty";

    const width = row.width_ft * 12 + row.width_in;
    const length = row.length_ft * 12 + row.length_in;
    const max = Math.max(width, length);

    if (max <= 72) return "small";
    if (max <= 108) return "medium";
    if (max <= 144) return "large";
    return "oversized";
  });
  const bySizeBand = countBy(sizeBands);

  const report = {
    ...input.summary,
    breakdown: {
      by_origin: byOrigin,
      by_size_range: bySizeBand,
      by_color: byColor,
    },
  };

  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  const lines: string[] = [];
  lines.push("# Live Intake Run Report");
  lines.push("");
  lines.push(`- Host: ${input.summary.host}`);
  lines.push(`- Tenant: ${input.summary.tenant_subdomain} (${input.summary.tenant_id})`);
  lines.push(`- Dataset: ${input.summary.dataset_path}`);
  lines.push(`- Total requested: ${input.summary.total_requested}`);
  lines.push(`- Total submitted: ${input.summary.total_submitted}`);
  lines.push(`- Batches completed: ${input.summary.total_batches_completed}`);
  lines.push(`- Stopped: ${input.summary.stopped ? "yes" : "no"}`);
  lines.push(`- Stop reason: ${input.summary.stop_reason ?? "n/a"}`);
  lines.push("");

  lines.push("## Breakdown by Origin");
  for (const [key, value] of Object.entries(byOrigin)) {
    lines.push(`- ${key}: ${value}`);
  }
  lines.push("");

  lines.push("## Breakdown by Size Range");
  for (const [key, value] of Object.entries(bySizeBand)) {
    lines.push(`- ${key}: ${value}`);
  }
  lines.push("");

  lines.push("## Breakdown by Dominant Color (planned dataset)");
  for (const [key, value] of Object.entries(byColor)) {
    lines.push(`- ${key}: ${value}`);
  }
  lines.push("");

  lines.push("## Batch Checkpoints");
  for (const batch of input.summary.batch_results) {
    lines.push(`- Batch ${batch.batch_index}: submitted=${batch.submitted}, issues=${batch.issues.length}, stop=${batch.should_stop ? "yes" : "no"}`);
  }

  fs.writeFileSync(onePagerPath, `${lines.join("\n")}\n`, "utf8");
}

async function main() {
  const args = parseArgs();
  loadEnv();

  const host = (args.host ?? "https://jjrugs.rugdesk.app").replace(/\/$/, "");
  const datasetPath = path.resolve(args.dataset ?? "");
  if (!datasetPath) {
    throw new Error("Missing --dataset=/abs/path/to/dataset.json");
  }

  const outputDir = path.resolve(
    args.output_dir ?? `scripts/testing/live-intake/output/run-${new Date().toISOString().replace(/[:.]/g, "-")}`
  );
  fs.mkdirSync(outputDir, { recursive: true });

  const batchSize = Number.parseInt(args.batch_size ?? String(DEFAULT_BATCH_SIZE), 10);
  if (!Number.isFinite(batchSize) || batchSize <= 0) {
    throw new Error("--batch_size must be a positive integer.");
  }

  const startAt = Math.max(0, Number.parseInt(args.start_at ?? "0", 10) || 0);
  const limit = Math.max(0, Number.parseInt(args.limit ?? "0", 10) || 0);
  const cronKickUrl =
    typeof args.cron_kick_url === "string" && args.cron_kick_url.trim().length > 0
      ? args.cron_kick_url.trim()
      : null;

  const dataset = readDataset(datasetPath);
  const selected =
    limit > 0
      ? dataset.slice(startAt, Math.min(startAt + limit, dataset.length))
      : dataset.slice(startAt);

  if (selected.length === 0) {
    throw new Error("No dataset rows selected for this run.");
  }

  const supabaseUrl = requireEnv("SUPABASE_URL");
  const supabaseSecret = requireEnv("SUPABASE_SECRET_KEY");
  const supabase = createClient(supabaseUrl, supabaseSecret, {
    auth: { persistSession: false },
  });

  const subdomain = parseSubdomain(host);
  const tenant = await resolveTenant({
    supabase,
    subdomain,
  });

  const runSummary: RunSummary = {
    run_started_at: new Date().toISOString(),
    run_finished_at: null,
    host,
    tenant_id: tenant.tenantId,
    tenant_subdomain: subdomain,
    dataset_path: datasetPath,
    total_requested: selected.length,
    total_submitted: 0,
    total_batches_completed: 0,
    stopped: false,
    stop_reason: null,
    stop_batch: null,
    batch_results: [],
    successful_stock_ids: [],
  };

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1400, height: 1000 },
  });
  const page = await context.newPage();

  let consecutiveSubmissionFailures = 0;
  const submitLatencies: number[] = [];
  const successfulRows: DatasetRecord[] = [];
  const writeTimestamps: number[] = [];

  try {
    await unlockStaffMode({
      page,
      host,
      passcode: tenant.passcode,
    });

    const totalBatches = Math.ceil(selected.length / batchSize);
    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex += 1) {
      const batchRows = selected.slice(batchIndex * batchSize, (batchIndex + 1) * batchSize);
      const submittedBatchRows: DatasetRecord[] = [];
      console.log(`\n[intake] Starting batch ${batchIndex + 1}/${totalBatches} (${batchRows.length} rugs)`);

      for (const row of batchRows) {
        let result: Awaited<ReturnType<typeof submitSingleRug>> | null = null;
        for (let attempt = 1; attempt <= 6; attempt += 1) {
          const now = Date.now();
          const cutoff = now - INTAKE_WRITE_WINDOW_MS;
          while (writeTimestamps.length > 0 && writeTimestamps[0]! <= cutoff) {
            writeTimestamps.shift();
          }

          if (writeTimestamps.length >= INTAKE_WRITE_MAX_REQUESTS) {
            const waitMs = Math.max(
              2_000,
              writeTimestamps[0]! + INTAKE_WRITE_WINDOW_MS - now + 1_000
            );
            console.log(
              `[intake] throttling ${Math.ceil(waitMs / 1000)}s to stay under inventory write rate limit`
            );
            await sleep(waitMs);
          }

          result = await submitSingleRug({ page, row });
          submitLatencies.push(result.latencyMs);
          writeTimestamps.push(Date.now());

          if (result.ok) {
            break;
          }

          if (result.status === 429 && attempt < 6) {
            const backoffMs = 35_000 * attempt;
            console.warn(
              `[intake] 429 rate-limited for stock_id=${row.stock_id}; retrying in ${Math.ceil(backoffMs / 1000)}s (attempt ${attempt}/6)`
            );
            await sleep(backoffMs);
            continue;
          }

          break;
        }

        if (!result) {
          consecutiveSubmissionFailures += 1;
          continue;
        }

        if (!result.ok) {
          consecutiveSubmissionFailures += 1;
          console.error(`[intake] submit failed stock_id=${row.stock_id} status=${result.status ?? "n/a"} error=${result.error}`);

          if (consecutiveSubmissionFailures >= 3) {
            runSummary.stopped = true;
            runSummary.stop_reason = "form_regression";
            runSummary.stop_batch = batchIndex + 1;
            break;
          }

          continue;
        }

        consecutiveSubmissionFailures = 0;
        runSummary.total_submitted += 1;
        runSummary.successful_stock_ids.push(row.stock_id);
        successfulRows.push(row);
        submittedBatchRows.push(row);

        if (result.latencyMs > 30_000) {
          runSummary.stopped = true;
          runSummary.stop_reason = "cost_signal";
          runSummary.stop_batch = batchIndex + 1;
          break;
        }
      }

      if (runSummary.stopped) {
        break;
      }

      const verification = await verifyBatch({
        supabase,
        tenantId: tenant.tenantId,
        batchIndex: batchIndex + 1,
        batchRows: submittedBatchRows,
        cronKickUrl,
      });
      runSummary.batch_results.push(verification);
      runSummary.total_batches_completed += 1;

      const verificationPath = path.join(outputDir, `batch-${String(batchIndex + 1).padStart(2, "0")}.json`);
      fs.writeFileSync(verificationPath, `${JSON.stringify(verification, null, 2)}\n`, "utf8");

      console.log(`[verify] batch=${batchIndex + 1} issues=${verification.issues.length} stop=${verification.should_stop}`);

      if (verification.should_stop) {
        runSummary.stopped = true;
        runSummary.stop_reason = verification.stop_reason;
        runSummary.stop_batch = batchIndex + 1;
        break;
      }
    }
  } finally {
    await page.close().catch(() => null);
    await context.close().catch(() => null);
    await browser.close().catch(() => null);
  }

  runSummary.run_finished_at = new Date().toISOString();

  await writeReport({
    outputDir,
    summary: runSummary,
    successfulRows,
  });

  const summaryPath = path.join(outputDir, "run-summary.json");
  fs.writeFileSync(summaryPath, `${JSON.stringify(runSummary, null, 2)}\n`, "utf8");

  console.log("\n[done] Run complete");
  console.log(`[done] summary: ${summaryPath}`);
  console.log(`[done] report:  ${path.join(outputDir, "run-report.md")}`);

  if (runSummary.stopped) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
