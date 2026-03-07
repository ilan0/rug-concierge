#!/usr/bin/env node

import path from "node:path";
import { z } from "zod";
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
} from "./common.mjs";

const args = process.argv.slice(2);
const baseUrl = readArgValue(args, "--base-url") ?? "http://127.0.0.1:3100";
const runId = readArgValue(args, "--run-id") ?? `api-contract-${Date.now()}`;
const tenantId = requireTenantId();
const artifactRoot = resolveArtifactRoot(runId);
const outputRoot = path.resolve(artifactRoot, "api-contract");
const reportPath = path.resolve(outputRoot, "report.md");
const jsonPath = path.resolve(outputRoot, "report.json");

const IntakeResponseSchema = z.object({
  rug: z.object({
    id: z.string().uuid(),
    tenant_id: z.string().min(1),
    intake_label: z.string().min(1),
    status: z.string().nullable(),
    price: z.number().nullable(),
    sale_price: z.number().nullable(),
    width_ft: z.number(),
    width_in: z.number(),
    length_ft: z.number(),
    length_in: z.number(),
    width_total_in: z.number(),
    length_total_in: z.number(),
    created_at: z.string(),
    primary_image_url: z.string().nullable(),
    primary_image_path: z.string().nullable(),
  }),
});

function staffCookie(tenant) {
  return `rug_ui_role=store_staff; rug_ui_tenant_id=${tenant}; rug_pilot_access=1`;
}

function retailCookie(tenant) {
  return `rug_ui_role=retail_customer; rug_ui_tenant_id=${tenant}; rug_pilot_access=1`;
}

function basePayload(label) {
  return {
    role: "store_staff",
    tenantId,
    intakeLabel: label,
    widthFt: 8,
    widthIn: 0,
    lengthFt: 10,
    lengthIn: 0,
    image: makeImageFile(),
  };
}

async function run() {
  const checks = [];
  const scenarioLog = [];
  const createdRugIds = new Set();
  const supabase = getSupabaseAdmin();

  const runCase = async (input) => {
    const response = await postMultipart(
      baseUrl,
      "/api/inventory/intake",
      input.formData,
      {
        cookie: input.cookie,
        headers: input.headers,
      }
    );

    scenarioLog.push({
      name: input.name,
      expected_status: input.expectStatus,
      actual_status: response.status,
      headers: response.headers,
      raw: response.raw,
      json: response.json,
      request: input.request,
    });

    const hasTrace =
      typeof response.headers.intake_route_trace_id === "string" &&
      response.headers.intake_route_trace_id.length > 0;

    pushCheck(checks, {
      name: `${input.name} returns expected status`,
      severity: input.severity,
      pass: response.status === input.expectStatus,
      details: {
        expected: input.expectStatus,
        actual: response.status,
      },
    });

    pushCheck(checks, {
      name: `${input.name} includes intake trace header`,
      severity: "P2",
      pass: hasTrace,
      details: {
        intake_route_trace_id: response.headers.intake_route_trace_id,
      },
    });

    if (input.expectErrorContains) {
      const errorMessage =
        response.json && typeof response.json.error === "string"
          ? response.json.error
          : null;
      pushCheck(checks, {
        name: `${input.name} returns deterministic error message`,
        severity: input.severity,
        pass: typeof errorMessage === "string" && errorMessage.includes(input.expectErrorContains),
        details: {
          expected_contains: input.expectErrorContains,
          actual: errorMessage,
        },
      });
    }

    if (input.onResponse) {
      await input.onResponse(response);
    }
  };

  const happyRugId = crypto.randomUUID();
  const happyLabel = `QA intake happy ${runId}`;
  await runCase({
    name: "happy path",
    severity: "P0",
    expectStatus: 200,
    cookie: staffCookie(tenantId),
    headers: {
      "x-intake-test-rug-id": happyRugId,
    },
    request: {
      tenant_id: tenantId,
      role: "store_staff",
      rug_id: happyRugId,
      intake_label: happyLabel,
      width_ft: 8,
      width_in: 0,
      length_ft: 10,
      length_in: 0,
      image_type: "image/png",
    },
    formData: buildIntakeForm(basePayload(happyLabel)),
    onResponse: async (response) => {
      const parsed = IntakeResponseSchema.safeParse(response.json);
      pushCheck(checks, {
        name: "happy path returns expected response schema",
        severity: "P0",
        pass: parsed.success,
        details: parsed.success ? { rug_id: parsed.data.rug.id } : parsed.error.flatten(),
      });

      const rugId =
        parsed.success && typeof parsed.data.rug.id === "string"
          ? parsed.data.rug.id
          : null;
      if (rugId) {
        createdRugIds.add(rugId);
      }
    },
  });

  await runCase({
    name: "missing image",
    severity: "P2",
    expectStatus: 400,
    expectErrorContains: "image is required",
    cookie: staffCookie(tenantId),
    request: {
      tenant_id: tenantId,
      role: "store_staff",
      intake_label: `QA missing image ${runId}`,
    },
    formData: (() => {
      const form = buildIntakeForm({
        ...basePayload(`QA missing image ${runId}`),
        image: undefined,
      });
      return form;
    })(),
  });

  await runCase({
    name: "missing dimensions",
    severity: "P2",
    expectStatus: 400,
    expectErrorContains: "required whole numbers",
    cookie: staffCookie(tenantId),
    request: {
      tenant_id: tenantId,
      role: "store_staff",
      intake_label: `QA missing dimensions ${runId}`,
    },
    formData: (() => {
      const form = new FormData();
      form.set("role", "store_staff");
      form.set("tenant_id", tenantId);
      form.set("intake_label", `QA missing dimensions ${runId}`);
      form.set("image", makeImageFile());
      return form;
    })(),
  });

  await runCase({
    name: "invalid inch range",
    severity: "P2",
    expectStatus: 400,
    expectErrorContains: "required whole numbers",
    cookie: staffCookie(tenantId),
    request: {
      width_in: 12,
      tenant_id: tenantId,
    },
    formData: buildIntakeForm({
      ...basePayload(`QA invalid inches ${runId}`),
      widthIn: 12,
    }),
  });

  await runCase({
    name: "zero dimensions",
    severity: "P2",
    expectStatus: 400,
    expectErrorContains: "greater than zero",
    cookie: staffCookie(tenantId),
    request: {
      width_ft: 0,
      width_in: 0,
      length_ft: 0,
      length_in: 0,
    },
    formData: buildIntakeForm({
      ...basePayload(`QA zero dimensions ${runId}`),
      widthFt: 0,
      widthIn: 0,
      lengthFt: 0,
      lengthIn: 0,
    }),
  });

  await runCase({
    name: "invalid MIME",
    severity: "P2",
    expectStatus: 400,
    expectErrorContains: "image/*",
    cookie: staffCookie(tenantId),
    request: {
      image_type: "text/plain",
    },
    formData: buildIntakeForm({
      ...basePayload(`QA invalid mime ${runId}`),
      image: new File(["not an image"], "invalid.txt", { type: "text/plain" }),
    }),
  });

  await runCase({
    name: "empty image file",
    severity: "P2",
    expectStatus: 400,
    expectErrorContains: "must not be empty",
    cookie: staffCookie(tenantId),
    request: {
      image_size: 0,
    },
    formData: buildIntakeForm({
      ...basePayload(`QA empty image ${runId}`),
      image: new File([], "empty.png", { type: "image/png" }),
    }),
  });

  await runCase({
    name: "oversize image file",
    severity: "P2",
    expectStatus: 400,
    expectErrorContains: "10MB or smaller",
    cookie: staffCookie(tenantId),
    request: {
      image_size: 10 * 1024 * 1024 + 1,
    },
    formData: buildIntakeForm({
      ...basePayload(`QA oversize image ${runId}`),
      image: new File([new Uint8Array(10 * 1024 * 1024 + 1)], "big.png", {
        type: "image/png",
      }),
    }),
  });

  await runCase({
    name: "missing tenant",
    severity: "P1",
    expectStatus: 400,
    expectErrorContains: "tenant_id is required",
    cookie: staffCookie(tenantId),
    request: {
      tenant_id: null,
    },
    formData: (() => {
      const form = buildIntakeForm({
        ...basePayload(`QA missing tenant ${runId}`),
      });
      form.delete("tenant_id");
      return form;
    })(),
  });

  await runCase({
    name: "unauthorized role",
    severity: "P1",
    expectStatus: 403,
    expectErrorContains: "not allowed",
    cookie: retailCookie(tenantId),
    request: {
      role: "retail_customer",
      cookie_role: "retail_customer",
    },
    formData: (() => {
      const form = buildIntakeForm({
        ...basePayload(`QA unauthorized role ${runId}`),
      });
      form.set("role", "retail_customer");
      return form;
    })(),
  });

  await runCase({
    name: "role cookie mismatch",
    severity: "P1",
    expectStatus: 403,
    expectErrorContains: "Role mismatch",
    cookie: retailCookie(tenantId),
    request: {
      role: "store_staff",
      cookie_role: "retail_customer",
    },
    formData: buildIntakeForm({
      ...basePayload(`QA role mismatch ${runId}`),
    }),
  });

  for (const rugId of createdRugIds) {
    await cleanupRugArtifacts({ supabase, tenantId, rugId });
  }

  const summary = summarizeChecks(checks);
  const report = renderMarkdownReport({
    title: "Intake API Contract Suite",
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

  console.log(`INTAKE API CONTRACT ${summary.passedAll ? "PASS" : "FAIL"}: ${summary.passed}/${checks.length}`);
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
    `# Intake API Contract Suite\n\n- Generated: ${nowIso()}\n- Error: ${fallback.error}\n`
  );
  console.error(error);
  process.exit(1);
});
