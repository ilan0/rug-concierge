#!/usr/bin/env node

import path from "node:path";
import { z } from "zod";
import {
  buildIntakeForm,
  cleanupRugArtifacts,
  getSupabaseAdmin,
  getText,
  lookupRugArtifacts,
  makeImageFile,
  nowIso,
  postJson,
  postMultipart,
  pushCheck,
  renderMarkdownReport,
  requireTenantId,
  resolveArtifactRoot,
  summarizeChecks,
  writeJson,
  writeText,
  readArgValue,
} from "./common.mjs";

const args = process.argv.slice(2);
const baseUrl = readArgValue(args, "--base-url") ?? "http://127.0.0.1:3100";
const runId = readArgValue(args, "--run-id") ?? `integration-${Date.now()}`;
const tenantId = requireTenantId();
const artifactRoot = resolveArtifactRoot(runId);
const outputRoot = path.resolve(artifactRoot, "integration");
const reportPath = path.resolve(outputRoot, "report.md");
const jsonPath = path.resolve(outputRoot, "report.json");

const RecommendResponseSchema = z.object({
  mode: z.string(),
  assistant_message: z.string(),
  recommendations: z.array(
    z.object({
      rug_id: z.string().uuid(),
    })
  ),
});

function staffCookie(tenant) {
  return `rug_ui_role=store_staff; rug_ui_tenant_id=${tenant}; rug_pilot_access=1`;
}

async function run() {
  const checks = [];
  const scenarioLog = [];
  const supabase = getSupabaseAdmin();

  const dimensions = {
    widthFt: 8,
    widthIn: 0,
    lengthFt: 10,
    lengthIn: 0,
  };
  const rugId = crypto.randomUUID();
  const intakeLabel = `QA intake integration ${runId}`;

  const intakeForm = buildIntakeForm({
    role: "store_staff",
    tenantId,
    intakeLabel,
    widthFt: dimensions.widthFt,
    widthIn: dimensions.widthIn,
    lengthFt: dimensions.lengthFt,
    lengthIn: dimensions.lengthIn,
    image: makeImageFile("integration.png"),
  });

  const intakeResponse = await postMultipart(baseUrl, "/api/inventory/intake", intakeForm, {
    cookie: staffCookie(tenantId),
    headers: {
      "x-intake-test-rug-id": rugId,
    },
  });

  scenarioLog.push({
    step: "intake_create",
    rug_id: rugId,
    response: intakeResponse,
  });

  pushCheck(checks, {
    name: "integration intake create returns 200",
    severity: "P0",
    pass: intakeResponse.status === 200,
    details: {
      status: intakeResponse.status,
    },
  });

  const artifactsAfterCreate = await lookupRugArtifacts({
    supabase,
    tenantId,
    rugId,
  });

  pushCheck(checks, {
    name: "created rug row exists with intake defaults",
    severity: "P0",
    pass:
      Boolean(artifactsAfterCreate.rug) &&
      artifactsAfterCreate.rug.status === "available" &&
      artifactsAfterCreate.rug.price === null &&
      artifactsAfterCreate.rug.sale_price === null,
    details: {
      rug: artifactsAfterCreate.rug,
      rug_error: artifactsAfterCreate.rugError,
    },
  });

  pushCheck(checks, {
    name: "created rug has exactly one primary rug_images row",
    severity: "P0",
    pass:
      artifactsAfterCreate.imageRows.length === 1 &&
      artifactsAfterCreate.imageRows[0]?.is_primary === true &&
      artifactsAfterCreate.imageRows[0]?.sort_order === 0,
    details: {
      image_rows: artifactsAfterCreate.imageRows,
      image_error: artifactsAfterCreate.imageError,
    },
  });

  pushCheck(checks, {
    name: "created rug has storage object",
    severity: "P0",
    pass: artifactsAfterCreate.storageObjects.length >= 1,
    details: {
      storage_objects: artifactsAfterCreate.storageObjects,
      storage_error: artifactsAfterCreate.storageError,
    },
  });

  const inventoryPage = await getText(
    baseUrl,
    `/inventory?q=${encodeURIComponent(intakeLabel)}`,
    {
      cookie: staffCookie(tenantId),
    }
  );

  scenarioLog.push({
    step: "inventory_visibility",
    status: inventoryPage.status,
    contains_label: inventoryPage.text.includes(intakeLabel),
    contains_rug_id: inventoryPage.text.includes(rugId),
  });

  pushCheck(checks, {
    name: "inventory page shows new intake label immediately",
    severity: "P1",
    pass:
      inventoryPage.status === 200 &&
      inventoryPage.text.includes(intakeLabel) &&
      inventoryPage.text.includes(rugId),
    details: {
      status: inventoryPage.status,
      contains_label: inventoryPage.text.includes(intakeLabel),
      contains_rug_id: inventoryPage.text.includes(rugId),
    },
  });

  const widthTotalIn = artifactsAfterCreate.rug?.width_total_in ?? null;
  const lengthTotalIn = artifactsAfterCreate.rug?.length_total_in ?? null;

  const recommendPayload = {
    role: "store_staff",
    tenant_id: tenantId,
    user_message: "Show recommendations for this exact size under $1.",
    constraints: {
      budgetMax: 1,
      size: {
        widthIn: widthTotalIn ?? 96,
        lengthIn: lengthTotalIn ?? 120,
        toleranceIn: 0,
      },
    },
  };

  const recommendResponse = await postJson(
    baseUrl,
    "/api/recommend",
    recommendPayload,
    {
      cookie: staffCookie(tenantId),
    }
  );

  scenarioLog.push({
    step: "recommendation_visibility",
    request: recommendPayload,
    response: recommendResponse,
  });

  const recommendParsed = RecommendResponseSchema.safeParse(recommendResponse.json);
  const recommendedIds = recommendParsed.success
    ? recommendParsed.data.recommendations.map((row) => row.rug_id)
    : [];

  const eligibilityQuery =
    typeof widthTotalIn === "number" && typeof lengthTotalIn === "number"
      ? await supabase
          .from("rugs")
          .select("id")
          .eq("tenant_id", tenantId)
          .eq("id", rugId)
          .eq("status", "available")
          .eq("width_total_in", widthTotalIn)
          .eq("length_total_in", lengthTotalIn)
          .is("sale_price", null)
          .or("price.lte.1,price.is.null")
      : { data: null, error: { message: "missing_dimensions" } };

  const eligibleByBackendFilter =
    !eligibilityQuery.error &&
    Array.isArray(eligibilityQuery.data) &&
    eligibilityQuery.data.some((row) => row.id === rugId);

  pushCheck(checks, {
    name: "recommend endpoint responds with valid envelope",
    severity: "P1",
    pass: recommendResponse.status === 200 && recommendParsed.success,
    details: {
      status: recommendResponse.status,
      parse_success: recommendParsed.success,
      parse_error: recommendParsed.success ? null : recommendParsed.error.flatten(),
    },
  });

  pushCheck(checks, {
    name: "newly intaked rug is recommendation eligible immediately",
    severity: "P1",
    pass: eligibleByBackendFilter,
    details: {
      rug_id: rugId,
      recommended_ids: recommendedIds,
      eligibility_query_error: eligibilityQuery.error?.message ?? null,
      eligible_by_backend_filter: eligibleByBackendFilter,
    },
  });

  pushCheck(checks, {
    name: "recommendation response includes new rug or preserves eligibility evidence",
    severity: "P2",
    pass: recommendedIds.includes(rugId) || eligibleByBackendFilter,
    details: {
      rug_id: rugId,
      recommended_ids: recommendedIds,
      eligible_by_backend_filter: eligibleByBackendFilter,
    },
  });

  const budgetEligibleByPolicy =
    artifactsAfterCreate.rug &&
    artifactsAfterCreate.rug.sale_price === null &&
    (artifactsAfterCreate.rug.price === null || artifactsAfterCreate.rug.price <= 1) &&
    eligibleByBackendFilter;

  pushCheck(checks, {
    name: "null price follows budget-as-zero policy assertion",
    severity: "P1",
    pass: Boolean(budgetEligibleByPolicy),
    details: {
      price: artifactsAfterCreate.rug?.price ?? null,
      sale_price: artifactsAfterCreate.rug?.sale_price ?? null,
      budget_max: 1,
    },
  });

  const cleanup = await cleanupRugArtifacts({
    supabase,
    tenantId,
    rugId,
  });

  scenarioLog.push({
    step: "cleanup",
    cleanup,
  });

  pushCheck(checks, {
    name: "integration cleanup removes all created artifacts",
    severity: "P0",
    pass:
      cleanup.errors.length === 0 &&
      !cleanup.post.rug &&
      cleanup.post.imageRows.length === 0 &&
      cleanup.post.storageObjects.length === 0,
    details: {
      cleanup_errors: cleanup.errors,
      post_rug_present: Boolean(cleanup.post.rug),
      post_rug_images_count: cleanup.post.imageRows.length,
      post_storage_objects_count: cleanup.post.storageObjects.length,
    },
  });

  const summary = summarizeChecks(checks);
  const report = renderMarkdownReport({
    title: "Intake Integration Suite",
    generatedAt: nowIso(),
    runId,
    baseUrl,
    tenantId,
    checks,
  });

  await writeText(reportPath, report);
  await writeJson(jsonPath, {
    generated_at: nowIso(),
    run_id: runId,
    base_url: baseUrl,
    tenant_id: tenantId,
    summary,
    checks,
    scenarios: scenarioLog,
  });

  console.log(`INTAKE INTEGRATION ${summary.passedAll ? "PASS" : "FAIL"}: ${summary.passed}/${checks.length}`);
  console.log(`Output: ${reportPath}`);

  if (!summary.passedAll) {
    process.exit(1);
  }
}

run().catch(async (error) => {
  const fallback = {
    generated_at: nowIso(),
    run_id: runId,
    base_url: baseUrl,
    tenant_id: tenantId,
    error: error instanceof Error ? error.message : String(error),
  };
  await writeJson(jsonPath, fallback);
  await writeText(
    reportPath,
    `# Intake Integration Suite\n\n- Generated: ${nowIso()}\n- Error: ${fallback.error}\n`
  );
  console.error(error);
  process.exit(1);
});
