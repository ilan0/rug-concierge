import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import nextEnv from "@next/env";

export const RUG_IMAGES_BUCKET = "rug-images";

export function readArgValue(args, flag) {
  const index = args.indexOf(flag);
  if (index === -1) return null;
  return args[index + 1] ?? null;
}

export function readArgInt(args, flag, fallback) {
  const raw = readArgValue(args, flag);
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

export function hasFlag(args, flag) {
  return args.includes(flag);
}

export function nowIso() {
  return new Date().toISOString();
}

export function toSlug(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

export function makeRunId(prefix = "intake") {
  const stamp = nowIso().replace(/[:.]/g, "-");
  return `${toSlug(prefix)}-${toSlug(stamp)}`;
}

export function requireTenantId() {
  const tenantId = (process.env.TENANT_ID ?? "").trim();
  if (!tenantId) {
    throw new Error("Missing TENANT_ID.");
  }
  return tenantId;
}

export function resolveArtifactRoot(runId) {
  return path.resolve(process.cwd(), "docs/testing/artifacts/intake", runId);
}

export async function ensureDir(dir) {
  await mkdir(dir, { recursive: true });
}

export async function writeJson(filePath, value) {
  await ensureDir(path.dirname(filePath));
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function writeText(filePath, value) {
  await ensureDir(path.dirname(filePath));
  await writeFile(filePath, value, "utf8");
}

export function tinyPngBytes() {
  return new Uint8Array([
    137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1,
    0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84,
    8, 215, 99, 248, 15, 4, 0, 9, 251, 3, 253, 160, 133, 129, 248, 0, 0, 0, 0,
    73, 69, 78, 68, 174, 66, 96, 130,
  ]);
}

export function makeImageFile(name = "qa-intake.png", mime = "image/png") {
  return new File([tinyPngBytes()], name, { type: mime });
}

export function buildIntakeForm(input) {
  const formData = new FormData();
  formData.set("role", input.role ?? "store_staff");
  formData.set("tenant_id", input.tenantId);
  formData.set("intake_label", input.intakeLabel);
  formData.set("width_ft", String(input.widthFt));
  formData.set("width_in", String(input.widthIn));
  formData.set("length_ft", String(input.lengthFt));
  formData.set("length_in", String(input.lengthIn));
  if (input.image !== undefined) {
    formData.set("image", input.image);
  }
  return formData;
}

export async function postMultipart(baseUrl, endpoint, formData, options = {}) {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method: "POST",
    headers: {
      ...(options.cookie ? { Cookie: options.cookie } : {}),
      ...(options.headers ?? {}),
    },
    body: formData,
  });

  const raw = await response.text();
  let json = null;
  try {
    json = JSON.parse(raw);
  } catch {
    json = null;
  }

  return {
    status: response.status,
    raw,
    json,
    headers: {
      intake_route_trace_id: response.headers.get("x-intake-route-trace-id"),
      intake_rug_id: response.headers.get("x-intake-rug-id"),
      intake_storage_path: response.headers.get("x-intake-storage-path"),
      intake_fail_step: response.headers.get("x-intake-test-fail-step"),
    },
  };
}

export async function postJson(baseUrl, endpoint, payload, options = {}) {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(options.cookie ? { Cookie: options.cookie } : {}),
      ...(options.headers ?? {}),
    },
    body: JSON.stringify(payload),
  });
  const raw = await response.text();
  let json = null;
  try {
    json = JSON.parse(raw);
  } catch {
    json = null;
  }
  return {
    status: response.status,
    raw,
    json,
    headers: {
      recommend_trace_id: response.headers.get("x-recommendation-trace-id"),
      recommend_route_trace_id: response.headers.get("x-recommend-route-trace-id"),
    },
  };
}

export async function getText(baseUrl, endpoint, options = {}) {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method: "GET",
    headers: {
      ...(options.cookie ? { Cookie: options.cookie } : {}),
      ...(options.headers ?? {}),
    },
  });
  const text = await response.text();
  return { status: response.status, text };
}

export function pushCheck(checks, input) {
  checks.push({
    name: input.name,
    severity: input.severity ?? "P2",
    pass: Boolean(input.pass),
    details: input.details ?? null,
  });
}

export function summarizeChecks(checks) {
  const passed = checks.filter((check) => check.pass).length;
  const failed = checks.length - passed;
  const failedBySeverity = {
    P0: checks.filter((check) => !check.pass && check.severity === "P0").length,
    P1: checks.filter((check) => !check.pass && check.severity === "P1").length,
    P2: checks.filter((check) => !check.pass && check.severity === "P2").length,
    P3: checks.filter((check) => !check.pass && check.severity === "P3").length,
  };

  return {
    passed,
    failed,
    failedBySeverity,
    openP0P1: failedBySeverity.P0 + failedBySeverity.P1,
    passedAll: failed === 0,
  };
}

export function renderMarkdownReport({ title, generatedAt, runId, baseUrl, tenantId, checks }) {
  const summary = summarizeChecks(checks);
  const lines = [
    `# ${title}`,
    "",
    `- Generated: ${generatedAt}`,
    `- Run ID: ${runId}`,
    `- Base URL: ${baseUrl}`,
    `- Tenant ID: ${tenantId}`,
    `- Passed: ${summary.passed}`,
    `- Failed: ${summary.failed}`,
    `- Open P0/P1: ${summary.openP0P1}`,
    "",
    "| Check | Severity | Result | Details |",
    "| --- | --- | --- | --- |",
    ...checks.map((check) => {
      const details = JSON.stringify(check.details ?? null);
      return `| ${check.name} | ${check.severity} | ${check.pass ? "PASS" : "FAIL"} | ${details} |`;
    }),
  ];
  return `${lines.join("\n")}\n`;
}

let envLoaded = false;

export function loadWebEnvIfNeeded() {
  if (envLoaded) return;
  const webRoot = path.resolve(process.cwd(), "apps/web");
  nextEnv.loadEnvConfig(webRoot);
  envLoaded = true;
}

export function getSupabaseAdmin() {
  loadWebEnvIfNeeded();
  const supabaseUrl =
    (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const supabaseKey = (process.env.SUPABASE_SECRET_KEY ?? "").trim();
  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      "Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY for intake QA."
    );
  }
  return createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
  });
}

export async function lookupRugArtifacts({ supabase, tenantId, rugId }) {
  const rugsResult = await supabase
    .from("rugs")
    .select("id, tenant_id, status, price, sale_price, width_total_in, length_total_in")
    .eq("tenant_id", tenantId)
    .eq("id", rugId)
    .maybeSingle();

  const imageRowsResult = await supabase
    .from("rug_images")
    .select("rug_id, path, is_primary, sort_order")
    .eq("tenant_id", tenantId)
    .eq("rug_id", rugId);

  const storageList = await supabase.storage
    .from(RUG_IMAGES_BUCKET)
    .list(`${tenantId}/${rugId}`, { limit: 100, offset: 0, sortBy: { column: "name", order: "asc" } });

  return {
    rug: rugsResult.data ?? null,
    rugError: rugsResult.error ? rugsResult.error.message : null,
    imageRows: Array.isArray(imageRowsResult.data) ? imageRowsResult.data : [],
    imageError: imageRowsResult.error ? imageRowsResult.error.message : null,
    storageObjects: Array.isArray(storageList.data)
      ? storageList.data
          .filter((item) => item && typeof item.name === "string" && item.name.length > 0)
          .map((item) => `${tenantId}/${rugId}/${item.name}`)
      : [],
    storageError: storageList.error ? storageList.error.message : null,
  };
}

export async function cleanupRugArtifacts({ supabase, tenantId, rugId }) {
  const pre = await lookupRugArtifacts({ supabase, tenantId, rugId });
  const removedStorage = [];
  const errors = [];

  if (pre.storageObjects.length > 0) {
    const removeResult = await supabase.storage.from(RUG_IMAGES_BUCKET).remove(pre.storageObjects);
    if (removeResult.error) {
      errors.push(`storage_remove_failed:${removeResult.error.message}`);
    } else {
      removedStorage.push(...pre.storageObjects);
    }
  }

  const imageDelete = await supabase
    .from("rug_images")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("rug_id", rugId);
  if (imageDelete.error) {
    errors.push(`rug_images_delete_failed:${imageDelete.error.message}`);
  }

  const rugDelete = await supabase
    .from("rugs")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("id", rugId);
  if (rugDelete.error) {
    errors.push(`rugs_delete_failed:${rugDelete.error.message}`);
  }

  const post = await lookupRugArtifacts({ supabase, tenantId, rugId });

  return {
    removedStorage,
    errors,
    pre,
    post,
  };
}

export async function fileExists(filePath) {
  return existsSync(filePath);
}

export async function readJsonSafe(filePath) {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
