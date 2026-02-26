#!/usr/bin/env node

import { writeFile } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const baseUrl = readArg("--base-url") ?? "http://127.0.0.1:3100";
const tenantId = (process.env.TENANT_ID ?? "").trim();
const outputPath = path.resolve(process.cwd(), "scripts/testing/functionality/latest.md");

if (!tenantId) {
  console.error("Missing TENANT_ID");
  process.exit(1);
}

function readArg(flag) {
  const index = args.indexOf(flag);
  if (index === -1) return null;
  return args[index + 1] ?? null;
}

function nowIso() {
  return new Date().toISOString();
}

function hasChatEnvelope(body) {
  return (
    body &&
    typeof body === "object" &&
    typeof body.session_id === "string" &&
    typeof body.mode === "string" &&
    typeof body.fine_mode === "string" &&
    body.response &&
    typeof body.response === "object" &&
    typeof body.response.mode === "string"
  );
}

function hasRecommendEnvelope(body) {
  return (
    body &&
    typeof body === "object" &&
    typeof body.mode === "string" &&
    typeof body.assistant_message === "string" &&
    Array.isArray(body.recommendations)
  );
}

function hasAppraisalEnvelope(body) {
  return body && typeof body === "object" && typeof body.mode === "string";
}

async function postJson(endpoint, body, extraHeaders = {}) {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...extraHeaders,
    },
    body: JSON.stringify(body),
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
    json,
    raw,
  };
}

function pushResult(results, name, pass, details) {
  results.push({ name, pass, details });
}

async function run() {
  const results = [];

  const general = await postJson("/api/chat", {
    role: "retail_customer",
    tenant_id: tenantId,
    message: "How do I clean a wool rug?",
  });
  pushResult(
    results,
    "chat endpoint returns 200 + valid envelope",
    general.status === 200 && hasChatEnvelope(general.json),
    { status: general.status }
  );

  const recommendation = await postJson("/api/recommend", {
    role: "retail_customer",
    tenant_id: tenantId,
    user_message: "show me what you have",
  });
  pushResult(
    results,
    "recommend endpoint returns 200 + valid envelope",
    recommendation.status === 200 && hasRecommendEnvelope(recommendation.json),
    { status: recommendation.status }
  );

  const appraisalStaff = await postJson(
    "/api/appraisal/generate",
    {
      role: "store_staff",
      tenant_id: tenantId,
      appraisal_context: {
        customer_name: "QA",
        rug_label: "Sample",
      },
    },
    {
      Cookie: "rug_ui_role=store_staff",
    }
  );
  pushResult(
    results,
    "appraisal endpoint allows staff and returns structured JSON",
    appraisalStaff.status === 200 && hasAppraisalEnvelope(appraisalStaff.json),
    { status: appraisalStaff.status }
  );

  const appraisalRetail = await postJson("/api/appraisal/generate", {
    role: "retail_customer",
    tenant_id: tenantId,
    appraisal_context: {
      customer_name: "QA",
    },
  });
  pushResult(
    results,
    "appraisal endpoint blocks retail (403, no 500)",
    appraisalRetail.status === 403,
    { status: appraisalRetail.status }
  );

  const roleMismatch = await postJson(
    "/api/chat",
    {
      role: "store_staff",
      tenant_id: tenantId,
      message: "show me what you have",
    },
    {
      Cookie: "rug_ui_role=retail_customer",
    }
  );
  pushResult(
    results,
    "role mismatch is rejected (403, no 500)",
    roleMismatch.status === 403,
    { status: roleMismatch.status }
  );

  const sessionStart = await postJson("/api/chat", {
    role: "retail_customer",
    tenant_id: tenantId,
    message: "show me what you have",
  });
  const sessionId = sessionStart.json?.session_id;
  const tenantMismatch = sessionId
    ? await postJson("/api/chat", {
        role: "retail_customer",
        session_id: sessionId,
        tenant_id: "00000000-0000-0000-0000-000000000000",
        message: "show me more",
      })
    : { status: 0 };

  pushResult(
    results,
    "tenant mismatch on existing session is rejected (403)",
    Boolean(sessionId) && tenantMismatch.status === 403,
    { status: tenantMismatch.status, session_id_present: Boolean(sessionId) }
  );

  const recommendMissingTenant = await postJson("/api/recommend", {
    role: "retail_customer",
    user_message: "show me what you have",
  });
  pushResult(
    results,
    "recommend missing tenant returns 400 (no 500)",
    recommendMissingTenant.status === 400,
    { status: recommendMissingTenant.status }
  );

  const passed = results.filter((row) => row.pass).length;
  const failed = results.length - passed;

  const lines = [
    "# Functionality Suite (Latest)",
    "",
    `- Generated: ${nowIso()}`,
    `- Base URL: ${baseUrl}`,
    `- Tenant ID: ${tenantId}`,
    `- Passed: ${passed}`,
    `- Failed: ${failed}`,
    "",
    "| Check | Result | Details |",
    "| --- | --- | --- |",
    ...results.map((row) =>
      `| ${row.name} | ${row.pass ? "PASS" : "FAIL"} | ${JSON.stringify(row.details)} |`
    ),
  ];

  await writeFile(outputPath, `${lines.join("\n")}\n`, "utf8");
  console.log(`Wrote ${outputPath}`);

  if (failed > 0) process.exit(1);
}

run().catch(async (error) => {
  await writeFile(
    outputPath,
    `# Functionality Suite (Latest)\n\n- Generated: ${nowIso()}\n- Error: ${
      error instanceof Error ? error.message : String(error)
    }\n`,
    "utf8"
  );
  console.error(error);
  process.exit(1);
});
