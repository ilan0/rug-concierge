#!/usr/bin/env node

import path from "node:path";
import {
  buildIntakeForm,
  cleanupRugArtifacts,
  getSupabaseAdmin,
  makeImageFile,
  nowIso,
  postMultipart,
  pushCheck,
  renderMarkdownReport,
  requireTenantId,
  resolveArtifactRoot,
  summarizeChecks,
  writeJson,
  writeText,
  readArgValue,
  lookupRugArtifacts,
} from "./common.mjs";

const args = process.argv.slice(2);
const baseUrl = readArgValue(args, "--base-url") ?? "http://127.0.0.1:3100";
const runId = readArgValue(args, "--run-id") ?? `rollback-${Date.now()}`;
const tenantId = requireTenantId();
const artifactRoot = resolveArtifactRoot(runId);
const outputRoot = path.resolve(artifactRoot, "rollback");
const reportPath = path.resolve(outputRoot, "report.md");
const jsonPath = path.resolve(outputRoot, "report.json");

function staffCookie(tenant) {
  return `rug_ui_role=store_staff; rug_ui_tenant_id=${tenant}; rug_pilot_access=1`;
}

function isOrphanFree(artifacts) {
  return !artifacts.rug && artifacts.imageRows.length === 0 && artifacts.storageObjects.length === 0;
}

async function run() {
  const checks = [];
  const scenarioLog = [];
  const supabase = getSupabaseAdmin();

  const scenarios = [
    {
      name: "forced failure before_insert_rug",
      failStep: "before_insert_rug",
      expectedErrorContains: "Unable to create intake record",
    },
    {
      name: "forced failure after_insert_rug",
      failStep: "after_insert_rug",
      expectedErrorContains: "Unable to upload intake image",
    },
    {
      name: "forced failure before_upload_image",
      failStep: "before_upload_image",
      expectedErrorContains: "Unable to upload intake image",
    },
    {
      name: "forced failure after_upload_image",
      failStep: "after_upload_image",
      expectedErrorContains: "Unable to upload intake image",
    },
    {
      name: "forced failure before_insert_rug_image",
      failStep: "before_insert_rug_image",
      expectedErrorContains: "Unable to finalize intake image metadata",
    },
    {
      name: "forced failure after_insert_rug_image",
      failStep: "after_insert_rug_image",
      expectedErrorContains: "Unable to finalize intake image metadata",
    },
    {
      name: "forced failure throw_after_upload",
      failStep: "throw_after_upload",
      expectedErrorContains: "Unable to intake rug right now",
    },
  ];

  for (const scenario of scenarios) {
    const rugId = crypto.randomUUID();
    const label = `QA rollback ${scenario.failStep} ${runId}`;
    const formData = buildIntakeForm({
      role: "store_staff",
      tenantId,
      intakeLabel: label,
      widthFt: 8,
      widthIn: 0,
      lengthFt: 10,
      lengthIn: 0,
      image: makeImageFile(`rollback-${scenario.failStep}.png`),
    });

    const response = await postMultipart(baseUrl, "/api/inventory/intake", formData, {
      cookie: staffCookie(tenantId),
      headers: {
        "x-intake-test-rug-id": rugId,
        "x-intake-test-fail-step": scenario.failStep,
      },
    });

    const artifacts = await lookupRugArtifacts({
      supabase,
      tenantId,
      rugId,
    });

    const orphanFree = isOrphanFree(artifacts);
    let cleanup = null;
    if (!orphanFree) {
      cleanup = await cleanupRugArtifacts({
        supabase,
        tenantId,
        rugId,
      });
    }

    scenarioLog.push({
      name: scenario.name,
      fail_step: scenario.failStep,
      rug_id: rugId,
      response,
      artifacts,
      cleanup,
    });

    pushCheck(checks, {
      name: `${scenario.name} returns 500`,
      severity: "P0",
      pass: response.status === 500,
      details: {
        expected: 500,
        actual: response.status,
      },
    });

    const errorMessage =
      response.json && typeof response.json.error === "string"
        ? response.json.error
        : null;
    pushCheck(checks, {
      name: `${scenario.name} returns expected error message`,
      severity: "P1",
      pass:
        typeof errorMessage === "string" &&
        errorMessage.includes(scenario.expectedErrorContains),
      details: {
        expected_contains: scenario.expectedErrorContains,
        actual: errorMessage,
      },
    });

    pushCheck(checks, {
      name: `${scenario.name} echoes fail-step header in QA mode`,
      severity: "P2",
      pass: response.headers.intake_fail_step === scenario.failStep,
      details: {
        expected: scenario.failStep,
        actual: response.headers.intake_fail_step,
      },
    });

    pushCheck(checks, {
      name: `${scenario.name} leaves no orphan rows/files`,
      severity: "P0",
      pass: orphanFree,
      details: {
        rug_present: Boolean(artifacts.rug),
        rug_images_count: artifacts.imageRows.length,
        storage_objects_count: artifacts.storageObjects.length,
        cleanup_errors: cleanup?.errors ?? [],
      },
    });
  }

  // Success control: ensure explicit cleanup path keeps environment clean.
  const successRugId = crypto.randomUUID();
  const successLabel = `QA rollback control ${runId}`;
  const successForm = buildIntakeForm({
    role: "store_staff",
    tenantId,
    intakeLabel: successLabel,
    widthFt: 9,
    widthIn: 1,
    lengthFt: 11,
    lengthIn: 2,
    image: makeImageFile("rollback-control.png"),
  });
  const successResponse = await postMultipart(baseUrl, "/api/inventory/intake", successForm, {
    cookie: staffCookie(tenantId),
    headers: {
      "x-intake-test-rug-id": successRugId,
    },
  });

  const controlCleanup = await cleanupRugArtifacts({
    supabase,
    tenantId,
    rugId: successRugId,
  });

  const controlOrphanFree =
    !controlCleanup.post.rug &&
    controlCleanup.post.imageRows.length === 0 &&
    controlCleanup.post.storageObjects.length === 0;

  scenarioLog.push({
    name: "success control",
    rug_id: successRugId,
    response: successResponse,
    cleanup: controlCleanup,
  });

  pushCheck(checks, {
    name: "success control creates intake row before cleanup",
    severity: "P1",
    pass: successResponse.status === 200,
    details: {
      status: successResponse.status,
    },
  });

  pushCheck(checks, {
    name: "success control cleanup removes all artifacts",
    severity: "P0",
    pass: controlOrphanFree && controlCleanup.errors.length === 0,
    details: {
      cleanup_errors: controlCleanup.errors,
      post_rug_present: Boolean(controlCleanup.post.rug),
      post_rug_images_count: controlCleanup.post.imageRows.length,
      post_storage_objects_count: controlCleanup.post.storageObjects.length,
    },
  });

  const summary = summarizeChecks(checks);
  const report = renderMarkdownReport({
    title: "Intake Rollback and Orphan Suite",
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

  console.log(`INTAKE ROLLBACK ${summary.passedAll ? "PASS" : "FAIL"}: ${summary.passed}/${checks.length}`);
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
    `# Intake Rollback and Orphan Suite\n\n- Generated: ${nowIso()}\n- Error: ${fallback.error}\n`
  );
  console.error(error);
  process.exit(1);
});
