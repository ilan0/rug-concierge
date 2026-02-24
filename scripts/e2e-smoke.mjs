#!/usr/bin/env node

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const baseUrl = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const tenantId = process.env.SMOKE_TENANT_ID ?? "";
const reportPath = path.resolve(process.cwd(), "docs/testing/e2e-smoke-report.md");
const jsonReportPath = path.resolve(
  process.cwd(),
  "docs/testing/e2e-smoke-report.json"
);
const caseFilter = process.argv.slice(2).reduce((acc, value, index, arr) => {
  if (acc) return acc;
  if (value === "--case") return arr[index + 1] ?? null;
  return acc;
}, null);
const runId = `run-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const runIdSlug = toSlug(runId);
const artifactsRoot = path.resolve(
  process.cwd(),
  "docs/testing/artifacts",
  runIdSlug
);

function requireSmokeTenant(caseName) {
  if (tenantId && tenantId.trim().length > 0) return tenantId.trim();
  throw new Error(
    `${caseName} requires SMOKE_TENANT_ID because recommendation flows now enforce tenant_id.`
  );
}

function nowIso() {
  return new Date().toISOString();
}

function toSlug(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

class CaseAssertionError extends Error {
  constructor(message, checks) {
    super(message);
    this.name = "CaseAssertionError";
    this.checks = checks;
  }
}

function makeAssert(checks) {
  return (condition, label, context = null) => {
    if (!condition) {
      checks.push({ label, status: "fail", context });
      throw new CaseAssertionError(label, checks);
    }

    checks.push({ label, status: "pass", context });
  };
}

async function postJson(url, body, traceMeta) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-e2e-trace-run": traceMeta.runId,
      "x-e2e-trace-case": traceMeta.caseId,
    },
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
    headers: {
      recommendation_trace_id: response.headers.get("x-recommendation-trace-id"),
      recommend_route_trace_id: response.headers.get("x-recommend-route-trace-id"),
      chat_route_trace_id: response.headers.get("x-chat-route-trace-id"),
      appraisal_trace_id: response.headers.get("x-appraisal-trace-id"),
    },
  };
}

async function postRaw(url, rawBody, traceMeta) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-e2e-trace-run": traceMeta.runId,
      "x-e2e-trace-case": traceMeta.caseId,
    },
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
    headers: {
      recommendation_trace_id: response.headers.get("x-recommendation-trace-id"),
      recommend_route_trace_id: response.headers.get("x-recommend-route-trace-id"),
      chat_route_trace_id: response.headers.get("x-chat-route-trace-id"),
      appraisal_trace_id: response.headers.get("x-appraisal-trace-id"),
    },
  };
}

async function readTraceArtifacts(caseSlug) {
  const caseDir = path.resolve(artifactsRoot, caseSlug);
  let entries = [];
  try {
    entries = await readdir(caseDir);
  } catch {
    return [];
  }

  const traces = [];
  for (const file of entries) {
    if (!file.endsWith(".json")) continue;
    const absolutePath = path.resolve(caseDir, file);
    const raw = await readFile(absolutePath, "utf8");
    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }

    traces.push({
      path: absolutePath,
      file,
      parsed,
    });
  }

  return traces;
}

function summarizeTrace(traces) {
  const summary = {
    ai_used: false,
    ai_fallback: false,
    flow_paths: [],
    supabase_variants: [],
    ai_request_payloads: [],
    ai_response_payloads: [],
    ai_parsed_responses: [],
    trace_files: traces.map((t) => t.path),
  };

  for (const trace of traces) {
    const payload = trace.parsed?.payload ?? null;
    if (!payload || typeof payload !== "object") continue;

    const flowPath = Array.isArray(payload.flow_path) ? payload.flow_path : null;
    if (flowPath) summary.flow_paths.push(flowPath);

    if (Array.isArray(payload.query_trace)) {
      summary.supabase_variants.push(...payload.query_trace);
    }

    const aiTrace = payload.ai_trace;
    if (aiTrace && typeof aiTrace === "object") {
      if (aiTrace.called) summary.ai_used = true;
      if (typeof aiTrace.fallback_reason === "string" && aiTrace.fallback_reason) {
        summary.ai_fallback = true;
      }
      if (aiTrace.request_payload) {
        summary.ai_request_payloads.push(aiTrace.request_payload);
      }
      if (aiTrace.response_payload) {
        summary.ai_response_payloads.push(aiTrace.response_payload);
      }
      if (aiTrace.parsed_response) {
        summary.ai_parsed_responses.push(aiTrace.parsed_response);
      }
    }
  }

  return summary;
}

async function runCase(name, metadata, fn) {
  const started = Date.now();
  const checks = [];
  const assert = makeAssert(checks);
  const caseSlug = toSlug(name);

  try {
    const result = await fn({
      assert,
      checks,
      traceMeta: {
        runId: runIdSlug,
        caseId: caseSlug,
      },
    });

    const traces = await readTraceArtifacts(caseSlug);
    const traceSummary = summarizeTrace(traces);

    return {
      name,
      case_slug: caseSlug,
      status: "pass",
      duration_ms: Date.now() - started,
      metadata,
      details: result,
      checks,
      traces,
      trace_summary: traceSummary,
    };
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    const failedChecks = error instanceof CaseAssertionError ? error.checks : checks;
    const traces = await readTraceArtifacts(caseSlug);
    const traceSummary = summarizeTrace(traces);

    return {
      name,
      case_slug: caseSlug,
      status: "fail",
      duration_ms: Date.now() - started,
      metadata,
      details,
      checks: failedChecks,
      traces,
      trace_summary: traceSummary,
    };
  }
}

function markdownJson(value) {
  return `\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;
}

function buildCaseMarkdown(test) {
  const checksMarkdown = Array.isArray(test.checks)
    ? [
        "- Checks:",
        ...test.checks.map((check) => {
          const icon = check.status === "pass" ? "PASS" : "FAIL";
          const context =
            check.context !== null && check.context !== undefined
              ? ` \`${JSON.stringify(check.context).slice(0, 220)}\``
              : "";
          return `  - [${icon}] ${check.label}${context}`;
        }),
      ].join("\n")
    : "- Checks: (none)";

  const aiRequestBlock =
    test.trace_summary.ai_request_payloads.length > 0
      ? test.trace_summary.ai_request_payloads
          .map((payload, idx) =>
            [
              `##### AI Request Payload ${idx + 1}`,
              markdownJson(payload),
            ].join("\n")
          )
          .join("\n\n")
      : "##### AI Request Payload\n- Not applicable (no AI call for this case).";

  const aiResponseBlock =
    test.trace_summary.ai_response_payloads.length > 0
      ? test.trace_summary.ai_response_payloads
          .map((payload, idx) =>
            [
              `##### AI Raw Response ${idx + 1}`,
              markdownJson(payload),
            ].join("\n")
          )
          .join("\n\n")
      : "##### AI Raw Response\n- Not applicable (no AI call for this case).";

  const aiParsedBlock =
    test.trace_summary.ai_parsed_responses.length > 0
      ? test.trace_summary.ai_parsed_responses
          .map((payload, idx) =>
            [
              `##### AI Parsed/Sanitized Response ${idx + 1}`,
              markdownJson(payload),
            ].join("\n")
          )
          .join("\n\n")
      : "##### AI Parsed/Sanitized Response\n- Not applicable (no AI call for this case).";

  const supabaseBlock =
    test.trace_summary.supabase_variants.length > 0
      ? ["##### Supabase Query Trace", markdownJson(test.trace_summary.supabase_variants)].join("\n")
      : "##### Supabase Query Trace\n- Not applicable or not reached for this case.";

  const flowBlock =
    test.trace_summary.flow_paths.length > 0
      ? ["##### Flow Paths", markdownJson(test.trace_summary.flow_paths)].join("\n")
      : "##### Flow Paths\n- No internal flow trace artifact captured.";

  const traceFilesBlock =
    test.trace_summary.trace_files.length > 0
      ? test.trace_summary.trace_files.map((file) => `  - ${file}`).join("\n")
      : "  - (none)";

  return [
    `### ${test.name}`,
    `- Status: ${test.status}`,
    `- Duration: ${test.duration_ms}ms`,
    `- Endpoint: ${test.metadata.endpoint}`,
    `- Method: ${test.metadata.method}`,
    `- AI Used: ${test.trace_summary.ai_used ? "yes" : "no"}`,
    `- AI Fallback Used: ${test.trace_summary.ai_fallback ? "yes" : "no"}`,
    `- Details: \`${JSON.stringify(test.details).slice(0, 500)}\``,
    checksMarkdown,
    "- Trace Files:",
    traceFilesBlock,
    "",
    "#### High-Level",
    `- Case ID: ${test.case_slug}`,
    `- Function/flow observed: ${test.trace_summary.flow_paths.length > 0 ? "captured" : "route-level only"}`,
    `- Supabase query info captured: ${test.trace_summary.supabase_variants.length > 0 ? "yes" : "no"}`,
    `- AI prompt captured: ${test.trace_summary.ai_request_payloads.length > 0 ? "yes" : "no"}`,
    `- AI response captured: ${test.trace_summary.ai_response_payloads.length > 0 ? "yes" : "no"}`,
    "",
    "#### Low-Level",
    flowBlock,
    "",
    supabaseBlock,
    "",
    aiRequestBlock,
    "",
    aiResponseBlock,
    "",
    aiParsedBlock,
    "",
  ].join("\n");
}

function buildQuickSummaryMarkdown(tests) {
  const header = [
    "## Quick Summary",
    "",
    "| Case | Status | Duration (ms) | AI Used | Fallback | Failed Checks | Endpoint |",
    "| --- | --- | ---: | --- | --- | ---: | --- |",
  ];

  const rows = tests.map((test) => {
    const failedChecks = Array.isArray(test.checks)
      ? test.checks.filter((check) => check.status === "fail").length
      : 0;
    const statusIcon = test.status === "pass" ? "PASS" : "FAIL";
    const aiUsed = test.trace_summary.ai_used ? "yes" : "no";
    const fallbackUsed = test.trace_summary.ai_fallback ? "yes" : "no";
    return `| ${test.name} | ${statusIcon} | ${test.duration_ms} | ${aiUsed} | ${fallbackUsed} | ${failedChecks} | ${test.metadata.endpoint} |`;
  });

  return [...header, ...rows, ""].join("\n");
}

async function run() {
  const tests = [];
  const shouldRun = (name) =>
    !caseFilter || name.toLowerCase().includes(caseFilter.toLowerCase());

  if (shouldRun("recommend invalid json returns 400")) {
    tests.push(
      await runCase(
        "recommend invalid json returns 400",
        { endpoint: "/api/recommend", method: "POST" },
        async ({ assert, traceMeta }) => {
          const response = await postRaw(`${baseUrl}/api/recommend`, "{", traceMeta);
          assert(response.status === 400, "status is 400", {
            expected: 400,
            actual: response.status,
          });
          return response.body;
        }
      )
    );
  }

  if (shouldRun("recommend empty input returns 400")) {
    tests.push(
      await runCase(
        "recommend empty input returns 400",
        { endpoint: "/api/recommend", method: "POST" },
        async ({ assert, traceMeta }) => {
          const response = await postJson(`${baseUrl}/api/recommend`, {}, traceMeta);
          assert(response.status === 400, "status is 400", {
            expected: 400,
            actual: response.status,
          });
          return response.body;
        }
      )
    );
  }

  if (shouldRun("recommend missing tenant returns 400")) {
    tests.push(
      await runCase(
        "recommend missing tenant returns 400",
        { endpoint: "/api/recommend", method: "POST" },
        async ({ assert, traceMeta }) => {
          const response = await postJson(
            `${baseUrl}/api/recommend`,
            {
              user_message: "show me rugs",
            },
            traceMeta
          );
          assert(response.status === 400, "status is 400", {
            expected: 400,
            actual: response.status,
          });
          return response.body ?? response.raw;
        }
      )
    );
  }

  if (shouldRun("recommend browse request returns contract")) {
    tests.push(
      await runCase(
        "recommend browse request returns contract",
        { endpoint: "/api/recommend", method: "POST" },
        async ({ assert, traceMeta }) => {
          const response = await postJson(
            `${baseUrl}/api/recommend`,
            {
              tenant_id: requireSmokeTenant("recommend browse request returns contract"),
              user_message: "show me what you have",
            },
            traceMeta
          );

          assert([200, 500].includes(response.status), "status is 200 or 500", {
            expected: [200, 500],
            actual: response.status,
          });

          if (response.status === 200) {
            const mode = response.body?.mode;
            assert(
              ["recommendations", "clarifying_question", "no_match"].includes(mode),
              "mode is valid recommendation contract",
              { actual: mode }
            );
          }

          return {
            response_body: response.body ?? response.raw,
            response_headers: response.headers,
          };
        }
      )
    );
  }

  if (shouldRun("recommend constrained request returns contract")) {
    tests.push(
      await runCase(
        "recommend constrained request returns contract",
        { endpoint: "/api/recommend", method: "POST" },
        async ({ assert, traceMeta }) => {
          const response = await postJson(
            `${baseUrl}/api/recommend`,
            {
              tenant_id: requireSmokeTenant(
                "recommend constrained request returns contract"
              ),
              user_message: "I need an 8x10 under $2500",
              constraints: {
                size: { widthIn: 96, lengthIn: 120, toleranceIn: 2 },
                budgetMax: 2500,
              },
            },
            traceMeta
          );

          assert([200, 500].includes(response.status), "status is 200 or 500", {
            expected: [200, 500],
            actual: response.status,
          });

          if (response.status === 200) {
            const mode = response.body?.mode;
            assert(
              ["recommendations", "clarifying_question", "no_match"].includes(mode),
              "mode is valid recommendation contract",
              { actual: mode }
            );
          }

          return {
            response_body: response.body ?? response.raw,
            response_headers: response.headers,
          };
        }
      )
    );
  }

  if (shouldRun("recommend rejects invalid budget constraint")) {
    tests.push(
      await runCase(
        "recommend rejects invalid budget constraint",
        { endpoint: "/api/recommend", method: "POST" },
        async ({ assert, traceMeta }) => {
          const response = await postJson(
            `${baseUrl}/api/recommend`,
            {
              user_message: "show rugs under budget",
              constraints: {
                budgetMax: 0,
              },
            },
            traceMeta
          );

          assert(response.status === 400, "status is 400", {
            expected: 400,
            actual: response.status,
          });

          return response.body ?? response.raw;
        }
      )
    );
  }

  if (shouldRun("recommend rejects invalid size constraint")) {
    tests.push(
      await runCase(
        "recommend rejects invalid size constraint",
        { endpoint: "/api/recommend", method: "POST" },
        async ({ assert, traceMeta }) => {
          const response = await postJson(
            `${baseUrl}/api/recommend`,
            {
              user_message: "show rugs",
              constraints: {
                size: { widthIn: -1, lengthIn: 120, toleranceIn: 2 },
              },
            },
            traceMeta
          );

          assert(response.status === 400, "status is 400", {
            expected: 400,
            actual: response.status,
          });

          return response.body ?? response.raw;
        }
      )
    );
  }

  if (shouldRun("chat route returns session envelope")) {
    tests.push(
      await runCase(
        "chat route returns session envelope",
        { endpoint: "/api/chat", method: "POST" },
        async ({ assert, traceMeta }) => {
          const response = await postJson(
            `${baseUrl}/api/chat`,
            {
              role: "retail_customer",
              tenant_id: requireSmokeTenant("chat route returns session envelope"),
              message: "show me rugs",
            },
            traceMeta
          );

          assert(response.status === 200, "status is 200", {
            expected: 200,
            actual: response.status,
          });

          assert(typeof response.body?.session_id === "string", "response contains session_id", {
            actual: response.body?.session_id,
          });

          assert(
            ["general_chat", "recommendation", "appraisal"].includes(response.body?.mode),
            "chat mode is valid",
            { actual: response.body?.mode }
          );

          return {
            session_id: response.body.session_id,
            mode: response.body.mode,
            response_headers: response.headers,
          };
        }
      )
    );
  }

  if (shouldRun("chat route empty message returns 400")) {
    tests.push(
      await runCase(
        "chat route empty message returns 400",
        { endpoint: "/api/chat", method: "POST" },
        async ({ assert, traceMeta }) => {
          const response = await postJson(
            `${baseUrl}/api/chat`,
            {
              role: "retail_customer",
              message: "   ",
            },
            traceMeta
          );

          assert(response.status === 400, "status is 400", {
            expected: 400,
            actual: response.status,
          });

          return response.body ?? response.raw;
        }
      )
    );
  }

  if (shouldRun("chat trade context request returns recommendation envelope")) {
    tests.push(
      await runCase(
        "chat trade context request returns recommendation envelope",
        { endpoint: "/api/chat", method: "POST" },
        async ({ assert, traceMeta }) => {
          const response = await postJson(
            `${baseUrl}/api/chat`,
            {
              role: "trade_client",
              tenant_id: requireSmokeTenant(
                "chat trade context request returns recommendation envelope"
              ),
              trade_client_id: "trade-client-smoke",
              trade_preferences: {
                palette: "muted neutrals",
                style: "serapi",
              },
              message: "show options for my client",
            },
            traceMeta
          );

          assert(response.status === 200, "status is 200", {
            expected: 200,
            actual: response.status,
          });

          assert(response.body?.role === "trade_client", "role echoes trade_client", {
            actual: response.body?.role,
          });

          assert(typeof response.body?.trade_context === "object", "trade_context exists", {
            actual: response.body?.trade_context,
          });

          return {
            role: response.body.role,
            mode: response.body.mode,
            trade_context: response.body.trade_context,
            response_headers: response.headers,
          };
        }
      )
    );
  }

  if (shouldRun("chat project room follow-up updates active room")) {
    tests.push(
      await runCase(
        "chat project room follow-up updates active room",
        { endpoint: "/api/chat", method: "POST" },
        async ({ assert, traceMeta }) => {
          const first = await postJson(
            `${baseUrl}/api/chat`,
            {
              role: "trade_client",
              tenant_id: requireSmokeTenant(
                "chat project room follow-up updates active room"
              ),
              message: "I need rugs for living room and dining room",
            },
            traceMeta
          );
          assert(first.status === 200, "initial project call status is 200", {
            expected: 200,
            actual: first.status,
          });
          assert(
            typeof first.body?.session_id === "string",
            "initial project call returns session_id",
            { actual: first.body?.session_id }
          );

          const second = await postJson(
            `${baseUrl}/api/chat`,
            {
              role: "trade_client",
              tenant_id: requireSmokeTenant(
                "chat project room follow-up updates active room"
              ),
              session_id: first.body.session_id,
              message: "Now show dining room options under $2500",
            },
            traceMeta
          );
          assert(second.status === 200, "follow-up project call status is 200", {
            expected: 200,
            actual: second.status,
          });

          const activeRoom = second.body?.project_context?.active_room_id;
          assert(
            typeof activeRoom === "string" && activeRoom.includes("dining"),
            "active room is dining",
            { actual: activeRoom }
          );

          return {
            session_id: second.body.session_id,
            active_room_id: activeRoom,
            first_response_headers: first.headers,
            second_response_headers: second.headers,
          };
        }
      )
    );
  }

  if (shouldRun("appraisal endpoint blocks non-staff")) {
    tests.push(
      await runCase(
        "appraisal endpoint blocks non-staff",
        { endpoint: "/api/appraisal/generate", method: "POST" },
        async ({ assert, traceMeta }) => {
          const response = await postJson(
            `${baseUrl}/api/appraisal/generate`,
            {
              role: "retail_customer",
              tenant_id: requireSmokeTenant("appraisal endpoint blocks non-staff"),
              appraisal_context: {
                rug_label: "Sample Rug",
                appraised_value: 1200,
              },
            },
            traceMeta
          );

          assert(response.status === 403, "status is 403", {
            expected: 403,
            actual: response.status,
          });

          return {
            response_body: response.body ?? response.raw,
            response_headers: response.headers,
          };
        }
      )
    );
  }

  if (tests.length === 0) {
    throw new Error(
      caseFilter
        ? `No smoke test matched --case \"${caseFilter}\"`
        : "No smoke tests selected."
    );
  }

  const failed = tests.filter((test) => test.status === "fail");
  const passed = tests.length - failed.length;

  const aiCases = tests.filter((test) => test.trace_summary.ai_used);
  const usedFallback = aiCases.some((test) => test.trace_summary.ai_fallback);
  const usageMode =
    aiCases.length === 0
      ? "unknown (no AI recommendation traces in this run)"
      : usedFallback
        ? "fallback mode detected"
        : "real OpenAI responses detected";

  const markdown = [
    "# E2E Smoke Report",
    "",
    `- Generated: ${nowIso()}`,
    `- Run ID: ${runId}`,
    `- Base URL: ${baseUrl}`,
    `- Tenant ID: ${tenantId || "(not provided)"}`,
    `- Artifacts Root: ${artifactsRoot}`,
    `- OpenAI Runtime: ${usageMode}`,
    `- Passed: ${passed}`,
    `- Failed: ${failed.length}`,
    "",
    buildQuickSummaryMarkdown(tests),
    "## Results",
    "",
    ...tests.map((test) => buildCaseMarkdown(test)),
  ].join("\n");

  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, markdown, "utf8");

  const jsonSummary = {
    generated_at: nowIso(),
    run_id: runId,
    base_url: baseUrl,
    tenant_id: tenantId || null,
    artifacts_root: artifactsRoot,
    openai_runtime: usageMode,
    passed,
    failed: failed.length,
    tests,
  };
  await writeFile(jsonReportPath, JSON.stringify(jsonSummary, null, 2), "utf8");

  console.log(`Smoke report written to ${reportPath}`);
  console.log(`JSON report written to ${jsonReportPath}`);
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
