#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const baseUrl = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const tenantId = process.env.SMOKE_TENANT_ID ?? "";
const reportPath = path.resolve(
  process.cwd(),
  "docs/testing/e2e-smoke-report.md"
);

function nowIso() {
  return new Date().toISOString();
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }

  return {
    status: response.status,
    ok: response.ok,
    body: parsed,
    raw: text,
  };
}

async function postRaw(url, rawBody) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: rawBody,
  });

  const text = await response.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }

  return {
    status: response.status,
    ok: response.ok,
    body: parsed,
    raw: text,
  };
}

async function runCase(name, fn) {
  const started = Date.now();
  try {
    const result = await fn();
    return {
      name,
      status: "pass",
      duration_ms: Date.now() - started,
      details: result,
    };
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    return {
      name,
      status: "fail",
      duration_ms: Date.now() - started,
      details,
    };
  }
}

async function run() {
  const tests = [];

  tests.push(
    await runCase("recommend invalid json returns 400", async () => {
      const response = await postRaw(`${baseUrl}/api/recommend`, "{");
      if (response.status !== 400) {
        throw new Error(`Expected 400, got ${response.status}`);
      }
      return response.body;
    })
  );

  tests.push(
    await runCase("recommend browse request returns contract", async () => {
      const response = await postJson(`${baseUrl}/api/recommend`, {
        tenant_id: tenantId || undefined,
        user_message: "show me what you have",
      });

      if (![200, 500].includes(response.status)) {
        throw new Error(`Expected 200 or 500, got ${response.status}`);
      }

      if (response.status === 200) {
        const mode = response.body?.mode;
        if (!["recommendations", "clarifying_question", "no_match"].includes(mode)) {
          throw new Error(`Unexpected mode: ${String(mode)}`);
        }
      }

      return response.body ?? response.raw;
    })
  );

  tests.push(
    await runCase("recommend constrained request returns contract", async () => {
      const response = await postJson(`${baseUrl}/api/recommend`, {
        tenant_id: tenantId || undefined,
        user_message: "I need an 8x10 under $2500",
        constraints: {
          size: { widthIn: 96, lengthIn: 120, toleranceIn: 2 },
          budgetMax: 2500,
        },
      });

      if (![200, 500].includes(response.status)) {
        throw new Error(`Expected 200 or 500, got ${response.status}`);
      }

      if (response.status === 200) {
        const mode = response.body?.mode;
        if (!["recommendations", "clarifying_question", "no_match"].includes(mode)) {
          throw new Error(`Unexpected mode: ${String(mode)}`);
        }
      }

      return response.body ?? response.raw;
    })
  );

  tests.push(
    await runCase("chat route returns session envelope", async () => {
      const response = await postJson(`${baseUrl}/api/chat`, {
        role: "retail_customer",
        message: "show me rugs",
      });

      if (response.status !== 200) {
        throw new Error(`Expected 200, got ${response.status}`);
      }

      if (typeof response.body?.session_id !== "string") {
        throw new Error("Missing session_id in response");
      }

      if (!["general_chat", "recommendation"].includes(response.body?.mode)) {
        throw new Error("Unexpected chat mode");
      }

      return {
        session_id: response.body.session_id,
        mode: response.body.mode,
      };
    })
  );

  const failed = tests.filter((test) => test.status === "fail");
  const passed = tests.length - failed.length;

  const markdown = [
    "# E2E Smoke Report",
    "",
    `- Generated: ${nowIso()}`,
    `- Base URL: ${baseUrl}`,
    `- Tenant ID: ${tenantId || "(not provided)"}`,
    `- Passed: ${passed}`,
    `- Failed: ${failed.length}`,
    "",
    "## Results",
    "",
    ...tests.map((test) => {
      const header = `### ${test.name}`;
      const status = `- Status: ${test.status}`;
      const duration = `- Duration: ${test.duration_ms}ms`;
      const details = `- Details: \`${JSON.stringify(test.details).slice(0, 500)}\``;
      return [header, status, duration, details, ""].join("\n");
    }),
  ].join("\n");

  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, markdown, "utf8");

  console.log(`Smoke report written to ${reportPath}`);
  console.log(`Passed ${passed}/${tests.length}`);

  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

run().catch((error) => {
  const details = error instanceof Error ? error.message : String(error);
  console.error("[e2e-smoke] Failed:", details);
  process.exit(1);
});

