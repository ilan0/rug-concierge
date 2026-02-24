#!/usr/bin/env node
import { writeFile } from "node:fs/promises";

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const TENANT_ID = process.env.SMOKE_TENANT_ID || process.env.TENANT_ID || "";

if (!TENANT_ID) {
  console.error(
    "Missing tenant id. Set SMOKE_TENANT_ID or TENANT_ID before running demo rehearsal."
  );
  process.exit(1);
}

function nowIso() {
  return new Date().toISOString();
}

async function postJson(path, body, cookie) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => null);
  return { status: response.status, payload };
}

function row(name, pass, details) {
  return { name, pass, details };
}

const checks = [];

const staffCookie = "rug_ui_role=store_staff";
const retailCookie = "rug_ui_role=retail_customer";
const developerCookie = "rug_ui_role=developer";

const chatStart = await postJson(
  "/api/chat",
  {
    role: "store_staff",
    tenant_id: TENANT_ID,
    message: "show me what you have",
  },
  staffCookie
);
checks.push(
  row(
    "Staff recommendation turn",
    chatStart.status === 200 && chatStart.payload?.mode === "recommendation",
    `status=${chatStart.status}, mode=${chatStart.payload?.mode ?? "unknown"}`
  )
);

const sessionId = chatStart.payload?.session_id ?? null;

const followup = sessionId
  ? await postJson(
      "/api/chat",
      {
        role: "store_staff",
        session_id: sessionId,
        tenant_id: TENANT_ID,
        message: "show me 8x10 rugs under $2500",
      },
      staffCookie
    )
  : { status: 0, payload: null };
checks.push(
  row(
    "Staff follow-up recommendation",
    followup.status === 200 && followup.payload?.mode === "recommendation",
    `status=${followup.status}, mode=${followup.payload?.mode ?? "unknown"}`
  )
);

const regenerate = sessionId
  ? await postJson(
      "/api/chat",
      {
        role: "store_staff",
        session_id: sessionId,
        tenant_id: TENANT_ID,
        message: "regenerate",
        review_action: "regenerate",
      },
      staffCookie
    )
  : { status: 0, payload: null };
checks.push(
  row(
    "Staff review regenerate action",
    regenerate.status === 200 &&
      regenerate.payload?.review_state?.decision === "regenerated",
    `status=${regenerate.status}, decision=${regenerate.payload?.review_state?.decision ?? "unknown"}`
  )
);

const appraisalStaff = await postJson(
  "/api/appraisal/generate",
  {
    role: "store_staff",
    tenant_id: TENANT_ID,
    appraisal_context: {
      customer_name: "Pilot Customer",
      rug_label: "Pilot Rug",
      rug_size_text: "8x10",
      currency: "USD",
    },
  },
  staffCookie
);
checks.push(
  row(
    "Staff appraisal draft generation",
    appraisalStaff.status === 200,
    `status=${appraisalStaff.status}, mode=${appraisalStaff.payload?.mode ?? "unknown"}`
  )
);

const appraisalRetail = await postJson(
  "/api/appraisal/generate",
  {
    role: "retail_customer",
    tenant_id: TENANT_ID,
    appraisal_context: {
      customer_name: "Pilot Customer",
    },
  },
  retailCookie
);
checks.push(
  row(
    "Retail appraisal blocked",
    appraisalRetail.status === 403,
    `status=${appraisalRetail.status}`
  )
);

const debugRetailResponse = await fetch(
  `${BASE_URL}/api/debug/trace?run=demo&case=pilot`,
  {
    headers: { Cookie: retailCookie },
  }
);
checks.push(
  row(
    "Retail debug trace blocked",
    debugRetailResponse.status === 403 || debugRetailResponse.status === 404,
    `status=${debugRetailResponse.status}`
  )
);

const debugDevResponse = await fetch(`${BASE_URL}/api/debug/trace?run=demo&case=pilot`, {
  headers: { Cookie: developerCookie },
});
checks.push(
  row(
    "Developer debug trace allowed",
    debugDevResponse.status === 200,
    `status=${debugDevResponse.status}`
  )
);

const passed = checks.filter((check) => check.pass).length;
const total = checks.length;
const failed = total - passed;

const reportLines = [
  "# Demo Rehearsal Report",
  "",
  `- Generated: ${nowIso()}`,
  `- Base URL: ${BASE_URL}`,
  `- Tenant ID: ${TENANT_ID}`,
  `- Passed: ${passed}`,
  `- Failed: ${failed}`,
  "",
  "| Scenario | Result | Details |",
  "| --- | --- | --- |",
  ...checks.map((check) => {
    const status = check.pass ? "PASS" : "FAIL";
    return `| ${check.name} | ${status} | ${check.details} |`;
  }),
];

const report = reportLines.join("\n");
await writeFile("docs/testing/demo-rehearsal-report.md", `${report}\n`, "utf8");

console.log(report);

if (failed > 0) {
  process.exit(1);
}
