#!/usr/bin/env node

import { writeFile } from "node:fs/promises";
import { createHmac } from "node:crypto";
import path from "node:path";

const args = process.argv.slice(2);
const baseUrl = readArg("--base-url") ?? "http://127.0.0.1:3100";
const tenantId = (process.env.TENANT_ID ?? "").trim();
const cookieSecret = (process.env.COOKIE_SECRET ?? "").trim();
const outputPath = path.resolve(
  process.cwd(),
  "scripts/testing/functionality/latest-functional.md"
);

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

function signedRoleCookie(role, tenant) {
  if (!cookieSecret) {
    throw new Error("Missing COOKIE_SECRET");
  }
  const signature = createHmac("sha256", cookieSecret)
    .update(`${role}:${tenant}`)
    .digest("base64url");
  return `${role}.${signature}`;
}

function signedRoleCookieHeader(role, tenant) {
  return `rug_ui_role=${signedRoleCookie(role, tenant)}; rug_ui_tenant_id=${tenant}`;
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
  return (
    body &&
    typeof body === "object" &&
    typeof body.mode === "string" &&
    typeof body.source_type === "string" &&
    typeof body.persisted === "boolean"
  );
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
    endpoint,
    status: response.status,
    json,
    raw,
    headers: {
      chat_route_trace_id: response.headers.get("x-chat-route-trace-id"),
      recommendation_trace_id: response.headers.get("x-recommendation-trace-id"),
      appraisal_trace_id: response.headers.get("x-appraisal-trace-id"),
    },
  };
}

async function getJson(endpoint, extraHeaders = {}) {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method: "GET",
    headers: {
      ...extraHeaders,
    },
  });

  const raw = await response.text();
  let json = null;
  try {
    json = JSON.parse(raw);
  } catch {
    json = null;
  }

  return {
    endpoint,
    status: response.status,
    json,
    raw,
    headers: {
      chat_route_trace_id: response.headers.get("x-chat-route-trace-id"),
      recommendation_trace_id: response.headers.get("x-recommendation-trace-id"),
      appraisal_trace_id: response.headers.get("x-appraisal-trace-id"),
    },
  };
}

async function postMultipart(endpoint, formData, extraHeaders = {}) {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method: "POST",
    headers: {
      ...extraHeaders,
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
    endpoint,
    status: response.status,
    json,
    raw,
    headers: {
      intake_trace_id: response.headers.get("x-intake-route-trace-id"),
    },
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
    {
      endpoint: general.endpoint,
      status: general.status,
      debug: general.headers,
    }
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
    {
      endpoint: recommendation.endpoint,
      status: recommendation.status,
      debug: recommendation.headers,
    }
  );

  const appraisalStaff = await postJson(
    "/api/appraisal/generate",
    {
      role: "store_staff",
      tenant_id: tenantId,
      source_type: "customer_owned",
      persist: false,
      appraisal_context: {
        customer_name: "QA",
        rug_type_label: "Sample Rug",
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
    {
      endpoint: appraisalStaff.endpoint,
      status: appraisalStaff.status,
      debug: appraisalStaff.headers,
    }
  );

  const appraisalInventoryStaff = await postJson(
    "/api/appraisal/generate",
    {
      role: "store_staff",
      tenant_id: tenantId,
      source_type: "inventory_linked",
      persist: false,
      appraisal_context: {
        customer_name: "QA",
      },
    },
    {
      Cookie: "rug_ui_role=store_staff",
    }
  );
  pushResult(
    results,
    "inventory-linked appraisal without rug_id fails safely (400, no 500)",
    appraisalInventoryStaff.status === 400,
    {
      endpoint: appraisalInventoryStaff.endpoint,
      status: appraisalInventoryStaff.status,
      debug: appraisalInventoryStaff.headers,
    }
  );

  const appraisalRetail = await postJson("/api/appraisal/generate", {
    role: "retail_customer",
    tenant_id: tenantId,
    source_type: "customer_owned",
    appraisal_context: {
      customer_name: "QA",
    },
  });
  pushResult(
    results,
    "appraisal endpoint blocks retail (403, no 500)",
    appraisalRetail.status === 403,
    {
      endpoint: appraisalRetail.endpoint,
      status: appraisalRetail.status,
      debug: appraisalRetail.headers,
    }
  );

  const roleMismatch = await postJson(
    "/api/chat",
    {
      role: "store_staff",
      tenant_id: tenantId,
      message: "show me what you have",
    },
    {
      Cookie: signedRoleCookieHeader("retail_customer", tenantId),
    }
  );
  pushResult(
    results,
    "role mismatch is rejected (403, no 500)",
    roleMismatch.status === 403,
    {
      endpoint: roleMismatch.endpoint,
      status: roleMismatch.status,
      debug: roleMismatch.headers,
    }
  );

  const chatAppraisalIntentStaff = await postJson(
    "/api/chat",
    {
      role: "store_staff",
      tenant_id: tenantId,
      message: "Please appraise this rug",
    },
    {
      Cookie: "rug_ui_role=store_staff",
    }
  );
  pushResult(
    results,
    "chat appraisal-like request remains general chat mode",
    chatAppraisalIntentStaff.status === 200 &&
      chatAppraisalIntentStaff.json &&
      typeof chatAppraisalIntentStaff.json === "object" &&
      chatAppraisalIntentStaff.json.mode === "general_chat" &&
      chatAppraisalIntentStaff.json.fine_mode === "general_chat",
    {
      endpoint: chatAppraisalIntentStaff.endpoint,
      status: chatAppraisalIntentStaff.status,
      debug: chatAppraisalIntentStaff.headers,
    }
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
    : { endpoint: "/api/chat", status: 0, headers: null };

  pushResult(
    results,
    "tenant mismatch on existing session is rejected (403)",
    Boolean(sessionId) && tenantMismatch.status === 403,
    {
      endpoint: tenantMismatch.endpoint,
      status: tenantMismatch.status,
      session_id_present: Boolean(sessionId),
      debug: tenantMismatch.headers,
    }
  );

  const recommendMissingTenant = await postJson("/api/recommend", {
    role: "retail_customer",
    user_message: "show me what you have",
  });
  pushResult(
    results,
    "recommend missing tenant returns 400 (no 500)",
    recommendMissingTenant.status === 400,
    {
      endpoint: recommendMissingTenant.endpoint,
      status: recommendMissingTenant.status,
      debug: recommendMissingTenant.headers,
    }
  );

  const intakeBaseForm = new FormData();
  intakeBaseForm.set("role", "store_staff");
  intakeBaseForm.set("tenant_id", tenantId);
  intakeBaseForm.set("intake_label", `QA Intake ${Date.now()}`);
  intakeBaseForm.set("width_ft", "8");
  intakeBaseForm.set("width_in", "0");
  intakeBaseForm.set("length_ft", "10");
  intakeBaseForm.set("length_in", "0");
  intakeBaseForm.set(
    "image",
    new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], "qa.png", {
      type: "image/png",
    })
  );
  const intakeHappyPath = await postMultipart(
    "/api/inventory/intake",
    intakeBaseForm,
    {
      Cookie: "rug_ui_role=store_staff",
    }
  );
  pushResult(
    results,
    "inventory intake happy path returns 200 and rug envelope",
    intakeHappyPath.status === 200 &&
      intakeHappyPath.json &&
      typeof intakeHappyPath.json === "object" &&
      typeof intakeHappyPath.json.rug === "object" &&
      intakeHappyPath.json.rug &&
      typeof intakeHappyPath.json.rug.id === "string",
    {
      endpoint: intakeHappyPath.endpoint,
      status: intakeHappyPath.status,
      debug: intakeHappyPath.headers,
    }
  );

  const intakeMissingImageForm = new FormData();
  intakeMissingImageForm.set("role", "store_staff");
  intakeMissingImageForm.set("tenant_id", tenantId);
  intakeMissingImageForm.set("intake_label", "QA Missing Image");
  intakeMissingImageForm.set("width_ft", "5");
  intakeMissingImageForm.set("width_in", "0");
  intakeMissingImageForm.set("length_ft", "7");
  intakeMissingImageForm.set("length_in", "6");
  const intakeMissingImage = await postMultipart(
    "/api/inventory/intake",
    intakeMissingImageForm,
    {
      Cookie: "rug_ui_role=store_staff",
    }
  );
  pushResult(
    results,
    "inventory intake missing image fails validation (400)",
    intakeMissingImage.status === 400,
    {
      endpoint: intakeMissingImage.endpoint,
      status: intakeMissingImage.status,
      debug: intakeMissingImage.headers,
    }
  );

  const intakeInvalidInchesForm = new FormData();
  intakeInvalidInchesForm.set("role", "store_staff");
  intakeInvalidInchesForm.set("tenant_id", tenantId);
  intakeInvalidInchesForm.set("intake_label", "QA Invalid Inches");
  intakeInvalidInchesForm.set("width_ft", "5");
  intakeInvalidInchesForm.set("width_in", "15");
  intakeInvalidInchesForm.set("length_ft", "7");
  intakeInvalidInchesForm.set("length_in", "6");
  intakeInvalidInchesForm.set(
    "image",
    new File([new Uint8Array([137, 80, 78, 71])], "qa-invalid.png", {
      type: "image/png",
    })
  );
  const intakeInvalidInches = await postMultipart(
    "/api/inventory/intake",
    intakeInvalidInchesForm,
    {
      Cookie: "rug_ui_role=store_staff",
    }
  );
  pushResult(
    results,
    "inventory intake rejects invalid inch ranges (400)",
    intakeInvalidInches.status === 400,
    {
      endpoint: intakeInvalidInches.endpoint,
      status: intakeInvalidInches.status,
      debug: intakeInvalidInches.headers,
    }
  );

  const intakeMissingTenantForm = new FormData();
  intakeMissingTenantForm.set("role", "store_staff");
  intakeMissingTenantForm.set("intake_label", "QA Missing Tenant");
  intakeMissingTenantForm.set("width_ft", "5");
  intakeMissingTenantForm.set("width_in", "0");
  intakeMissingTenantForm.set("length_ft", "7");
  intakeMissingTenantForm.set("length_in", "6");
  intakeMissingTenantForm.set(
    "image",
    new File([new Uint8Array([137, 80, 78, 71])], "qa-missing-tenant.png", {
      type: "image/png",
    })
  );
  const intakeMissingTenant = await postMultipart(
    "/api/inventory/intake",
    intakeMissingTenantForm,
    {
      Cookie: "rug_ui_role=store_staff",
    }
  );
  pushResult(
    results,
    "inventory intake requires tenant context (400)",
    intakeMissingTenant.status === 400,
    {
      endpoint: intakeMissingTenant.endpoint,
      status: intakeMissingTenant.status,
      debug: intakeMissingTenant.headers,
    }
  );

  const intakeRoleMismatchForm = new FormData();
  intakeRoleMismatchForm.set("role", "store_staff");
  intakeRoleMismatchForm.set("tenant_id", tenantId);
  intakeRoleMismatchForm.set("intake_label", "QA Role Mismatch");
  intakeRoleMismatchForm.set("width_ft", "5");
  intakeRoleMismatchForm.set("width_in", "0");
  intakeRoleMismatchForm.set("length_ft", "7");
  intakeRoleMismatchForm.set("length_in", "6");
  intakeRoleMismatchForm.set(
    "image",
    new File([new Uint8Array([255, 216, 255, 224])], "qa.jpg", {
      type: "image/jpeg",
    })
  );
  const intakeRoleMismatch = await postMultipart(
    "/api/inventory/intake",
    intakeRoleMismatchForm,
    {
      Cookie: signedRoleCookieHeader("retail_customer", tenantId),
    }
  );
  pushResult(
    results,
    "inventory intake role mismatch rejected (403)",
    intakeRoleMismatch.status === 403,
    {
      endpoint: intakeRoleMismatch.endpoint,
      status: intakeRoleMismatch.status,
      debug: intakeRoleMismatch.headers,
    }
  );

  const appraisalRugsStaff = await getJson(
    `/api/appraisal/rugs?tenant_id=${encodeURIComponent(tenantId)}&role=store_staff&limit=5`,
    {
      Cookie: "rug_ui_role=store_staff",
    }
  );
  pushResult(
    results,
    "appraisal rugs lookup allows staff and returns rows envelope",
    appraisalRugsStaff.status === 200 &&
      appraisalRugsStaff.json &&
      typeof appraisalRugsStaff.json === "object" &&
      Array.isArray(appraisalRugsStaff.json.rows),
    {
      endpoint: appraisalRugsStaff.endpoint,
      status: appraisalRugsStaff.status,
      debug: appraisalRugsStaff.headers,
    }
  );

  const appraisalRugsRetail = await getJson(
    `/api/appraisal/rugs?tenant_id=${encodeURIComponent(tenantId)}&role=retail_customer&limit=5`
  );
  pushResult(
    results,
    "appraisal rugs lookup blocks retail (403, no 500)",
    appraisalRugsRetail.status === 403,
    {
      endpoint: appraisalRugsRetail.endpoint,
      status: appraisalRugsRetail.status,
      debug: appraisalRugsRetail.headers,
    }
  );

  const appraisalDraftSave = await postJson(
    "/api/appraisal/drafts",
    {
      role: "store_staff",
      tenant_id: tenantId,
      source_type: "customer_owned",
      status: "draft",
      appraisal_context: {
        customer_name: "QA",
        rug_type_label: "Test Rug",
        condition: "good",
        appraisal_date: "2026-02-27",
        appraised_value: 1200,
      },
      draft_payload: {
        mode: "appraisal_draft",
      },
      draft_text: "Test draft",
    },
    {
      Cookie: "rug_ui_role=store_staff",
    }
  );

  const inaccessibleAppraisalId = crypto.randomUUID();
  const appraisalDraftSaveForbidden = await postJson(
    "/api/appraisal/drafts",
    {
      role: "store_staff",
      tenant_id: tenantId,
      source_type: "customer_owned",
      appraisal_id: inaccessibleAppraisalId,
      status: "draft",
      appraisal_context: {
        customer_name: "QA",
        rug_type_label: "Test Rug",
        condition: "good",
        appraisal_date: "2026-02-27",
        appraised_value: 1200,
      },
      draft_payload: {
        mode: "appraisal_draft",
      },
      draft_text: "Test draft",
    },
    {
      Cookie: "rug_ui_role=store_staff",
    }
  );
  pushResult(
    results,
    "appraisal drafts save rejects inaccessible appraisal_id (403, no cross-tenant overwrite)",
    appraisalDraftSaveForbidden.status === 403,
    {
      endpoint: appraisalDraftSaveForbidden.endpoint,
      status: appraisalDraftSaveForbidden.status,
      debug: appraisalDraftSaveForbidden.headers,
    }
  );

  const appraisalGenerateForbidden = await postJson(
    "/api/appraisal/generate",
    {
      role: "store_staff",
      tenant_id: tenantId,
      source_type: "customer_owned",
      appraisal_id: inaccessibleAppraisalId,
      persist: true,
      appraisal_context: {
        customer_name: "QA",
        rug_type_label: "Sample Rug",
        appraisal_date: "2026-02-27",
        condition: "good",
        appraised_value: 1800,
      },
    },
    {
      Cookie: "rug_ui_role=store_staff",
    }
  );
  pushResult(
    results,
    "appraisal generate rejects inaccessible appraisal_id (403, no cross-tenant overwrite)",
    appraisalGenerateForbidden.status === 403,
    {
      endpoint: appraisalGenerateForbidden.endpoint,
      status: appraisalGenerateForbidden.status,
      debug: appraisalGenerateForbidden.headers,
    }
  );
  pushResult(
    results,
    "appraisal drafts save allows staff and returns persistence envelope",
    appraisalDraftSave.status === 200 &&
      appraisalDraftSave.json &&
      typeof appraisalDraftSave.json === "object" &&
      typeof appraisalDraftSave.json.persisted === "boolean",
    {
      endpoint: appraisalDraftSave.endpoint,
      status: appraisalDraftSave.status,
      debug: appraisalDraftSave.headers,
    }
  );
  const savedAppraisalId =
    appraisalDraftSave.json &&
    typeof appraisalDraftSave.json === "object" &&
    typeof appraisalDraftSave.json.appraisal_id === "string"
      ? appraisalDraftSave.json.appraisal_id
      : null;

  const finalizeSavedDraft = savedAppraisalId
    ? await postJson(
        "/api/appraisal/drafts",
        {
          role: "store_staff",
          tenant_id: tenantId,
          source_type: "customer_owned",
          appraisal_id: savedAppraisalId,
          status: "finalized",
          appraisal_context: {
            customer_name: "QA",
            rug_type_label: "Test Rug",
            condition: "good",
            appraisal_date: "2026-02-27",
            appraised_value: 1200,
          },
          draft_payload: {
            mode: "appraisal_draft",
          },
          draft_text: "Finalized draft",
        },
        {
          Cookie: "rug_ui_role=store_staff",
        }
      )
    : { endpoint: "/api/appraisal/drafts", status: 0, headers: null };
  pushResult(
    results,
    "appraisal draft can be finalized by staff",
    Boolean(savedAppraisalId) && finalizeSavedDraft.status === 200,
    {
      endpoint: finalizeSavedDraft.endpoint,
      status: finalizeSavedDraft.status,
      appraisal_id_present: Boolean(savedAppraisalId),
      debug: finalizeSavedDraft.headers,
    }
  );

  const regenerateFinalized = savedAppraisalId
    ? await postJson(
        "/api/appraisal/generate",
        {
          role: "store_staff",
          tenant_id: tenantId,
          source_type: "customer_owned",
          appraisal_id: savedAppraisalId,
          persist: true,
          appraisal_context: {
            customer_name: "QA",
            rug_type_label: "Test Rug",
            condition: "good",
            appraisal_date: "2026-02-27",
            appraised_value: 1200,
          },
        },
        {
          Cookie: "rug_ui_role=store_staff",
        }
      )
    : { endpoint: "/api/appraisal/generate", status: 0, headers: null };
  pushResult(
    results,
    "finalized appraisal cannot be regenerated",
    Boolean(savedAppraisalId) && regenerateFinalized.status === 403,
    {
      endpoint: regenerateFinalized.endpoint,
      status: regenerateFinalized.status,
      appraisal_id_present: Boolean(savedAppraisalId),
      debug: regenerateFinalized.headers,
    }
  );

  const modifyFinalized = savedAppraisalId
    ? await postJson(
        "/api/appraisal/drafts",
        {
          role: "store_staff",
          tenant_id: tenantId,
          source_type: "customer_owned",
          appraisal_id: savedAppraisalId,
          status: "reviewed",
          appraisal_context: {
            customer_name: "QA",
            rug_type_label: "Test Rug",
            condition: "good",
            appraisal_date: "2026-02-27",
            appraised_value: 1200,
          },
          draft_payload: {
            mode: "appraisal_draft",
          },
          draft_text: "Attempt to edit finalized draft",
        },
        {
          Cookie: "rug_ui_role=store_staff",
        }
      )
    : { endpoint: "/api/appraisal/drafts", status: 0, headers: null };
  pushResult(
    results,
    "finalized appraisal cannot be modified via drafts save",
    Boolean(savedAppraisalId) && modifyFinalized.status === 403,
    {
      endpoint: modifyFinalized.endpoint,
      status: modifyFinalized.status,
      appraisal_id_present: Boolean(savedAppraisalId),
      debug: modifyFinalized.headers,
    }
  );

  const appraisalDraftList = await getJson(
    `/api/appraisal/drafts?tenant_id=${encodeURIComponent(tenantId)}&role=store_staff&limit=5`,
    {
      Cookie: "rug_ui_role=store_staff",
    }
  );
  pushResult(
    results,
    "appraisal drafts list allows staff and returns rows envelope",
    appraisalDraftList.status === 200 &&
      appraisalDraftList.json &&
      typeof appraisalDraftList.json === "object" &&
      Array.isArray(appraisalDraftList.json.rows),
    {
      endpoint: appraisalDraftList.endpoint,
      status: appraisalDraftList.status,
      debug: appraisalDraftList.headers,
    }
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

  console.log(`FUNCTIONAL ${failed === 0 ? "PASS" : "FAIL"}: ${passed}/${results.length}`);
  console.log(`Output: ${outputPath}`);
  if (failed > 0) {
    console.log("Failed checks:");
    for (const row of results.filter((item) => !item.pass)) {
      console.log(
        `- ${row.name} | endpoint=${row.details?.endpoint ?? "unknown"} | status=${
          row.details?.status ?? "unknown"
        } | debug=${JSON.stringify(row.details?.debug ?? null)}`
      );
    }
  }

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
