#!/usr/bin/env tsx

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

type CheckResult = {
  name: string;
  passed: boolean;
  details?: string;
};

type DemoRugRow = {
  id: string;
  stock_id: string | null;
  intake_label: string | null;
  ai_description: string | null;
  ai_structured_fields: unknown;
  staff_overrides: unknown;
};

type RecommendResponse = {
  mode?: unknown;
  recommendations?: unknown;
};

const REPORT_PATH =
  "/Users/ilannabatkhorian/Documents/rug-concierge/tmp/release-validation/overnight-phase2-report.json";

const REQUIRED_STOCK_IDS = [
  "DEMO-001",
  "DEMO-002",
  "DEMO-003",
  "DEMO-004",
  "DEMO-005",
  "DEMO-006",
  "DEMO-007",
  "DEMO-008",
] as const;

function loadEnvFileIfExists(filePath: string) {
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
  const cwd = process.cwd();
  loadEnvFileIfExists(path.join(cwd, ".env.local"));
  loadEnvFileIfExists(path.join(cwd, "apps/web/.env.local"));
}

function assertEnv(name: string): string {
  const value = (process.env[name] ?? "").trim();
  if (!value) {
    throw new Error(`Missing ${name} environment variable.`);
  }
  return value;
}

function assertAnyEnv(names: string[]): string {
  for (const name of names) {
    const value = (process.env[name] ?? "").trim();
    if (value) return value;
  }
  throw new Error(`Missing one of: ${names.join(", ")} environment variables.`);
}

function containsKeyDeep(value: unknown, key: string): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => containsKeyDeep(item, key));
  }
  if (!value || typeof value !== "object") return false;

  const record = value as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(record, key)) return true;
  return Object.values(record).some((item) => containsKeyDeep(item, key));
}

function sentenceCount(text: string | null): number {
  if (!text) return 0;
  const normalized = text.trim();
  if (!normalized) return 0;

  const chunks = normalized
    .split(/[.!?]+/)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0);

  if (chunks.length === 0) return 1;
  return chunks.length;
}

function looksLikeDimensionLabel(label: string | null): boolean {
  if (!label) return false;
  const text = label.toLowerCase();
  if (/\b\d{1,3}\s?(x|×)\s?\d{1,3}\b/.test(text)) return true;
  if (/\b\d{1,2}\s*'\s*(?:x|×)?\s*\d{1,2}\b/.test(text)) return true;
  if (/\b\d{1,2}\s*(ft|feet)\b/.test(text)) return true;
  return false;
}

async function postJson(input: {
  url: string;
  body: unknown;
  headers?: Record<string, string>;
}): Promise<{ status: number; payload: unknown; headers: Headers }> {
  const response = await fetch(input.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(input.headers ?? {}),
    },
    body: JSON.stringify(input.body),
  });

  const payload = (await response.json().catch(() => null)) as unknown;
  return {
    status: response.status,
    payload,
    headers: response.headers,
  };
}

async function patchJson(input: {
  url: string;
  body: unknown;
  headers?: Record<string, string>;
}): Promise<{ status: number; payload: unknown; headers: Headers }> {
  const response = await fetch(input.url, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      ...(input.headers ?? {}),
    },
    body: JSON.stringify(input.body),
  });

  const payload = (await response.json().catch(() => null)) as unknown;
  return {
    status: response.status,
    payload,
    headers: response.headers,
  };
}

async function getJson(input: {
  url: string;
  headers?: Record<string, string>;
}): Promise<{ status: number; payload: unknown }> {
  const response = await fetch(input.url, {
    method: "GET",
    headers: input.headers,
  });

  const payload = (await response.json().catch(() => null)) as unknown;
  return {
    status: response.status,
    payload,
  };
}

function asRecommendations(payload: unknown): unknown[] {
  if (!payload || typeof payload !== "object") return [];
  const recs = (payload as RecommendResponse).recommendations;
  return Array.isArray(recs) ? recs : [];
}

function asMode(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  return typeof (payload as RecommendResponse).mode === "string"
    ? ((payload as RecommendResponse).mode as string)
    : null;
}

async function main() {
  loadEnv();

  const baseUrl = assertEnv("BASE_URL").replace(/\/$/, "");
  const tenantId = assertEnv("TENANT_ID");
  const storePasscode = assertEnv("STORE_PASSCODE");
  const supabaseUrl = assertEnv("SUPABASE_URL");
  const supabaseKey = assertAnyEnv([
    "SUPABASE_SECRET_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
  ]);

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
  });

  const checks: CheckResult[] = [];
  const addCheck = (name: string, passed: boolean, details?: string) => {
    checks.push({ name, passed, details });
  };

  const { data: rugRows, error: rugError } = await supabase
    .from("rugs")
    .select("id, stock_id, intake_label, ai_description, ai_structured_fields, staff_overrides")
    .eq("tenant_id", tenantId)
    .in("stock_id", [...REQUIRED_STOCK_IDS])
    .order("stock_id", { ascending: true });

  if (rugError) {
    throw new Error(`Failed to query demo rugs: ${rugError.message}`);
  }

  const rugs = (rugRows ?? []) as DemoRugRow[];
  const stockIds = new Set(rugs.map((row) => row.stock_id).filter((x): x is string => Boolean(x)));
  const missingStockIds = REQUIRED_STOCK_IDS.filter((stockId) => !stockIds.has(stockId));

  addCheck(
    "seeded demo rugs present",
    missingStockIds.length === 0,
    missingStockIds.length > 0 ? `Missing: ${missingStockIds.join(", ")}` : "All 8 demo rugs present"
  );

  const sampleRug = rugs[0] ?? null;
  if (!sampleRug) {
    throw new Error("No demo rugs found. Run seed + enrichment first.");
  }

  const retailDetail = await getJson({
    url: `${baseUrl}/api/rugs/${encodeURIComponent(sampleRug.id)}`,
  });

  const retailPayload = retailDetail.payload as Record<string, unknown> | null;
  const retailHasEffectiveFields =
    retailPayload &&
    typeof retailPayload === "object" &&
    retailPayload.effective_fields &&
    typeof retailPayload.effective_fields === "object";

  addCheck(
    "retail detail returns 200",
    retailDetail.status === 200,
    `status=${retailDetail.status}`
  );
  addCheck(
    "retail detail includes effective_fields",
    Boolean(retailHasEffectiveFields),
    retailHasEffectiveFields ? undefined : "effective_fields missing"
  );
  addCheck(
    "retail detail omits contextual_blurb",
    !containsKeyDeep(retailDetail.payload, "contextual_blurb")
  );
  addCheck(
    "retail detail omits ai_structured_fields",
    !containsKeyDeep(retailDetail.payload, "ai_structured_fields")
  );
  addCheck(
    "retail detail omits staff_overrides",
    !containsKeyDeep(retailDetail.payload, "staff_overrides")
  );

  const recommendContract = await postJson({
    url: `${baseUrl}/api/recommend`,
    body: {
      tenant_id: tenantId,
      user_message: "I need an 8x10 rug for a traditional living room",
      constraints: {
        size: {
          widthIn: 96,
          lengthIn: 120,
          toleranceIn: 0,
        },
      },
    },
  });

  const contractRecommendations = asRecommendations(recommendContract.payload);
  const hasStructuredKeys = contractRecommendations.every((item) => {
    if (!item || typeof item !== "object") return false;
    const rec = item as Record<string, unknown>;
    return (
      Object.prototype.hasOwnProperty.call(rec, "origin") &&
      Object.prototype.hasOwnProperty.call(rec, "style") &&
      Object.prototype.hasOwnProperty.call(rec, "mood")
    );
  });

  addCheck(
    "recommendation contract returns 200",
    recommendContract.status === 200,
    `status=${recommendContract.status}`
  );
  addCheck(
    "recommendation contract returns at least one item",
    contractRecommendations.length > 0,
    `count=${contractRecommendations.length}`
  );
  addCheck(
    "recommendation items include origin/style/mood keys",
    hasStructuredKeys
  );
  addCheck(
    "recommendation payload omits contextual_blurb",
    !containsKeyDeep(recommendContract.payload, "contextual_blurb")
  );

  const unlockResponse = await postJson({
    url: `${baseUrl}/api/auth/passcode`,
    body: { passcode: storePasscode },
  });
  const setCookie = unlockResponse.headers.get("set-cookie") ?? "";
  const staffCookieMatch = setCookie.match(/staff_unlocked=[^;]+/i);
  const staffCookieHeader = staffCookieMatch ? staffCookieMatch[0] : "";

  addCheck(
    "staff unlock returns 200",
    unlockResponse.status === 200,
    `status=${unlockResponse.status}`
  );
  addCheck(
    "staff unlock sets cookie",
    Boolean(staffCookieHeader),
    staffCookieHeader ? undefined : "staff_unlocked cookie not found"
  );

  const staffDetail = await getJson({
    url: `${baseUrl}/api/inventory/rugs/${encodeURIComponent(sampleRug.id)}`,
    headers: staffCookieHeader ? { Cookie: staffCookieHeader } : undefined,
  });

  const staffPayload = staffDetail.payload as Record<string, unknown> | null;
  addCheck("staff detail returns 200", staffDetail.status === 200, `status=${staffDetail.status}`);
  addCheck(
    "staff detail includes ai_structured_fields",
    Boolean(staffPayload && Object.prototype.hasOwnProperty.call(staffPayload, "ai_structured_fields"))
  );
  addCheck(
    "staff detail includes staff_overrides",
    Boolean(staffPayload && Object.prototype.hasOwnProperty.call(staffPayload, "staff_overrides"))
  );
  addCheck(
    "staff detail includes effective_fields",
    Boolean(staffPayload && Object.prototype.hasOwnProperty.call(staffPayload, "effective_fields"))
  );

  const overrideSet = await patchJson({
    url: `${baseUrl}/api/inventory/rugs/${encodeURIComponent(sampleRug.id)}`,
    body: {
      staff_overrides: {
        mood: "modern",
        label: "Override Test Label",
      },
    },
    headers: staffCookieHeader ? { Cookie: staffCookieHeader } : undefined,
  });

  const overrideSetPayload = overrideSet.payload as Record<string, unknown> | null;
  const overrideSetEffective = (overrideSetPayload?.effective_fields ?? null) as
    | Record<string, unknown>
    | null;

  addCheck("override set returns 200", overrideSet.status === 200, `status=${overrideSet.status}`);
  addCheck(
    "override set updates effective mood",
    overrideSetEffective?.mood === "modern",
    `effective mood=${String(overrideSetEffective?.mood ?? "<missing>")}`
  );
  addCheck(
    "override set updates effective label",
    overrideSetEffective?.label === "Override Test Label",
    `effective label=${String(overrideSetEffective?.label ?? "<missing>")}`
  );

  const overrideUnset = await patchJson({
    url: `${baseUrl}/api/inventory/rugs/${encodeURIComponent(sampleRug.id)}`,
    body: {
      staff_overrides: {
        mood: null,
      },
    },
    headers: staffCookieHeader ? { Cookie: staffCookieHeader } : undefined,
  });

  const overrideUnsetPayload = overrideUnset.payload as Record<string, unknown> | null;
  const overrideUnsetRaw = (overrideUnsetPayload?.staff_overrides ?? null) as
    | Record<string, unknown>
    | null;
  addCheck("override unset returns 200", overrideUnset.status === 200, `status=${overrideUnset.status}`);
  addCheck(
    "override unset removes mood key",
    Boolean(overrideUnsetRaw && !Object.prototype.hasOwnProperty.call(overrideUnsetRaw, "mood"))
  );

  const overrideInvalid = await patchJson({
    url: `${baseUrl}/api/inventory/rugs/${encodeURIComponent(sampleRug.id)}`,
    body: {
      staff_overrides: null,
    },
    headers: staffCookieHeader ? { Cookie: staffCookieHeader } : undefined,
  });

  addCheck(
    "override invalid payload returns 400",
    overrideInvalid.status === 400,
    `status=${overrideInvalid.status}`
  );

  const qualityCases: Array<{
    name: string;
    body: Record<string, unknown>;
    expectNoMatch: boolean;
  }> = [
    {
      name: "8x10 traditional living room",
      body: {
        tenant_id: tenantId,
        user_message: "I need an 8x10 rug for a traditional living room",
        constraints: {
          size: {
            widthIn: 96,
            lengthIn: 120,
            toleranceIn: 0,
          },
        },
      },
      expectNoMatch: false,
    },
    {
      name: "smallest rugs",
      body: {
        tenant_id: tenantId,
        user_message: "Show me your smallest rugs",
      },
      expectNoMatch: false,
    },
    {
      name: "large dining room",
      body: {
        tenant_id: tenantId,
        user_message: "I need something for a large dining room",
      },
      expectNoMatch: false,
    },
    {
      name: "hallway",
      body: {
        tenant_id: tenantId,
        user_message: "Show me a rug I can use in a hallway",
      },
      expectNoMatch: false,
    },
    {
      name: "12x20 no-match",
      body: {
        tenant_id: tenantId,
        user_message: "I need a 12x20 rug",
        constraints: {
          size: {
            widthIn: 144,
            lengthIn: 240,
            toleranceIn: 0,
          },
        },
      },
      expectNoMatch: true,
    },
  ];

  for (const testCase of qualityCases) {
    const response = await postJson({
      url: `${baseUrl}/api/recommend`,
      body: testCase.body,
    });

    const mode = asMode(response.payload);
    const recommendations = asRecommendations(response.payload);

    addCheck(
      `[quality] ${testCase.name} returns 200`,
      response.status === 200,
      `status=${response.status}`
    );

    if (testCase.expectNoMatch) {
      addCheck(
        `[quality] ${testCase.name} returns no_match mode`,
        mode === "no_match",
        `mode=${mode ?? "<missing>"}`
      );
      addCheck(
        `[quality] ${testCase.name} has zero recommendations`,
        recommendations.length === 0,
        `count=${recommendations.length}`
      );
    } else {
      addCheck(
        `[quality] ${testCase.name} returns recommendations`,
        recommendations.length > 0,
        `count=${recommendations.length}`
      );
    }
  }

  const { data: finalRows, error: finalError } = await supabase
    .from("rugs")
    .select("id, stock_id, intake_label, ai_description, ai_structured_fields, staff_overrides")
    .eq("tenant_id", tenantId)
    .in("stock_id", [...REQUIRED_STOCK_IDS])
    .order("stock_id", { ascending: true });
  if (finalError) {
    throw new Error(`Failed to query final rug state: ${finalError.message}`);
  }
  const finalRugs = (finalRows ?? []) as DemoRugRow[];

  const dimensionLabels = finalRugs
    .filter((rug) => looksLikeDimensionLabel(rug.intake_label))
    .map((rug) => `${rug.stock_id}:${rug.intake_label}`);
  addCheck(
    "seed labels contain no dimension patterns",
    dimensionLabels.length === 0,
    dimensionLabels.length > 0 ? dimensionLabels.join(" | ") : undefined
  );

  const descriptionViolations = finalRugs
    .map((rug) => ({ stock_id: rug.stock_id ?? "<unknown>", count: sentenceCount(rug.ai_description) }))
    .filter((item) => item.count < 1 || item.count > 2);
  addCheck(
    "ai_description sentence counts are 1-2",
    descriptionViolations.length === 0,
    descriptionViolations.length > 0
      ? descriptionViolations
          .map((item) => `${item.stock_id}:${item.count}`)
          .join(", ")
      : undefined
  );

  const totalRugs = finalRugs.length;
  const enrichedCount = finalRugs.filter((rug) => rug.ai_structured_fields !== null).length;
  const hasOverrides = finalRugs.filter((rug) => rug.staff_overrides !== null).length;
  const fallbackLabelCount = finalRugs.filter((rug) => (rug.intake_label ?? "").startsWith("Rug ")).length;

  addCheck("total rugs is 8", totalRugs === 8, `total=${totalRugs}`);
  addCheck("all rugs enriched", enrichedCount === 8, `enriched=${enrichedCount}`);
  addCheck("at least one rug has overrides", hasOverrides >= 1, `has_overrides=${hasOverrides}`);
  addCheck("fallback label count is 0", fallbackLabelCount === 0, `fallback=${fallbackLabelCount}`);

  const passed = checks.filter((check) => check.passed).length;
  const failed = checks.filter((check) => !check.passed).length;
  const report = {
    base_url: baseUrl,
    tenant_id: tenantId,
    generated_at: new Date().toISOString(),
    summary: {
      total: checks.length,
      passed,
      failed,
    },
    checks,
  };

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

  console.log(JSON.stringify(report, null, 2));

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
