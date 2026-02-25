#!/usr/bin/env node

import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const TESTING_DIR = path.resolve(ROOT, "docs/testing");
const ARTIFACTS_DIR = path.resolve(TESTING_DIR, "artifacts");
const SUMMARY_MD_PATH = path.resolve(TESTING_DIR, "latest-summary.md");
const SUMMARY_JSON_PATH = path.resolve(TESTING_DIR, "latest-summary.json");

const BASE_URL = process.env.QA_BASE_URL ?? "http://127.0.0.1:3100";
const baseUrlObj = new URL(BASE_URL);
const SERVER_PORT =
  process.env.QA_PORT ??
  baseUrlObj.port ??
  (baseUrlObj.protocol === "https:" ? "443" : "80");

const TENANT_ID = (process.env.SMOKE_TENANT_ID ?? "").trim();
const OPENAI_RUNTIME_HINT =
  (process.env.OPENAI_API_KEY ?? "").trim().length > 0 ? "real" : "fallback";
let openAiRuntime = OPENAI_RUNTIME_HINT;

const gates = [];
let serverProcess = null;

function nowIso() {
  return new Date().toISOString();
}

function durationMs(startedAt) {
  return Date.now() - startedAt;
}

function normalizeTail(value) {
  if (!value) return "";
  return value.length > 6000 ? value.slice(-6000) : value;
}

function summarizeDetails(value) {
  if (value == null) return null;
  const raw = JSON.stringify(value);
  if (raw.length <= 800) return value;
  return {
    preview: `${raw.slice(0, 800)}...`,
  };
}

function addGate(name, status, duration, details = null, command = null) {
  gates.push({
    name,
    status,
    duration_ms: duration,
    details: summarizeDetails(details),
    command,
  });
}

async function runCommand(name, command, args, options = {}) {
  const startedAt = Date.now();
  const child = spawn(command, args, {
    cwd: ROOT,
    env: {
      ...process.env,
      ...(options.env ?? {}),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdoutTail = "";
  let stderrTail = "";

  child.stdout.on("data", (chunk) => {
    const text = chunk.toString();
    process.stdout.write(text);
    stdoutTail = normalizeTail(`${stdoutTail}${text}`);
  });

  child.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    process.stderr.write(text);
    stderrTail = normalizeTail(`${stderrTail}${text}`);
  });

  const [code] = await once(child, "close");
  const ok = code === 0;

  addGate(
    name,
    ok ? "pass" : "fail",
    durationMs(startedAt),
    {
      exit_code: code,
      stdout_tail: stdoutTail || null,
      stderr_tail: stderrTail || null,
    },
    `${command} ${args.join(" ")}`
  );

  return { ok };
}

async function waitForServerReady(url, timeoutMs = 90000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (!serverProcess || serverProcess.exitCode !== null) {
      return {
        ok: false,
        details: {
          error: "server process exited before readiness",
          exit_code: serverProcess?.exitCode ?? null,
        },
      };
    }

    try {
      const response = await fetch(url, { method: "GET" });
      if (response.status >= 200 && response.status < 500) {
        return {
          ok: true,
          details: { status: response.status },
        };
      }
    } catch {
      // Keep polling until timeout.
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return {
    ok: false,
    details: {
      error: "timed out waiting for server",
      timeout_ms: timeoutMs,
    },
  };
}

async function startServer() {
  const startedAt = Date.now();
  const serverEnv = {
    PORT: String(SERVER_PORT),
  };

  serverProcess = spawn("npm", ["--workspace", "apps/web", "run", "start"], {
    cwd: ROOT,
    env: {
      ...process.env,
      ...serverEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdoutTail = "";
  let stderrTail = "";

  serverProcess.stdout.on("data", (chunk) => {
    const text = chunk.toString();
    process.stdout.write(text);
    stdoutTail = normalizeTail(`${stdoutTail}${text}`);
  });

  serverProcess.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    process.stderr.write(text);
    stderrTail = normalizeTail(`${stderrTail}${text}`);
  });

  const ready = await waitForServerReady(BASE_URL);
  addGate(
    "start server",
    ready.ok ? "pass" : "fail",
    durationMs(startedAt),
    {
      ...ready.details,
      stdout_tail: stdoutTail || null,
      stderr_tail: stderrTail || null,
      base_url: BASE_URL,
      port: String(SERVER_PORT),
    },
    `npm --workspace apps/web run start (PORT=${SERVER_PORT})`
  );

  return ready.ok;
}

async function stopServer() {
  if (!serverProcess || serverProcess.exitCode !== null) return;

  serverProcess.kill("SIGTERM");
  const timeout = new Promise((resolve) => setTimeout(resolve, 5000));
  await Promise.race([once(serverProcess, "exit"), timeout]);

  if (serverProcess.exitCode === null) {
    serverProcess.kill("SIGKILL");
    await once(serverProcess, "exit");
  }
}

async function postJson(endpoint, body, extraHeaders = {}) {
  const response = await fetch(`${BASE_URL}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });

  const raw = await response.text();
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }

  return {
    status: response.status,
    body: parsed,
    raw,
  };
}

async function runHttpCheck(name, endpoint, body, expectedStatus, extraHeaders = {}) {
  const startedAt = Date.now();

  try {
    const response = await postJson(endpoint, body, extraHeaders);
    const ok = response.status === expectedStatus;
    addGate(
      name,
      ok ? "pass" : "fail",
      durationMs(startedAt),
      {
        expected_status: expectedStatus,
        actual_status: response.status,
        body: response.body ?? response.raw,
      },
      `POST ${endpoint}`
    );
  } catch (error) {
    addGate(
      name,
      "fail",
      durationMs(startedAt),
      {
        error: error instanceof Error ? error.message : String(error),
      },
      `POST ${endpoint}`
    );
  }
}

async function cleanupOldArtifacts() {
  const startedAt = Date.now();

  try {
    const entries = await readdir(ARTIFACTS_DIR, { withFileTypes: true });
    const runDirs = entries
      .filter((entry) => entry.isDirectory() && entry.name.startsWith("run-"))
      .map((entry) => entry.name);

    if (runDirs.length <= 1) {
      addGate("cleanup artifacts", "pass", durationMs(startedAt), {
        kept: runDirs[0] ?? null,
        removed_count: 0,
      });
      return;
    }

    const withStats = await Promise.all(
      runDirs.map(async (name) => {
        const absolutePath = path.resolve(ARTIFACTS_DIR, name);
        const metadata = await stat(absolutePath);
        return {
          name,
          absolutePath,
          mtime_ms: metadata.mtimeMs,
        };
      })
    );

    withStats.sort((a, b) => b.mtime_ms - a.mtime_ms);
    const [keep, ...remove] = withStats;

    for (const entry of remove) {
      await rm(entry.absolutePath, { recursive: true, force: true });
    }

    addGate("cleanup artifacts", "pass", durationMs(startedAt), {
      kept: keep.name,
      removed_count: remove.length,
      removed: remove.map((entry) => entry.name),
    });
  } catch (error) {
    addGate("cleanup artifacts", "fail", durationMs(startedAt), {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function writeSummary() {
  await mkdir(TESTING_DIR, { recursive: true });

  const failedGates = gates.filter((gate) => gate.status !== "pass");
  const overall = failedGates.length === 0 ? "GO" : "NO-GO";

  const jsonSummary = {
    generated_at: nowIso(),
    base_url: BASE_URL,
    tenant_id: TENANT_ID || null,
    openai_runtime: openAiRuntime,
    overall,
    passed: gates.length - failedGates.length,
    failed: failedGates.length,
    gates,
    outputs: {
      summary_md: "docs/testing/latest-summary.md",
      summary_json: "docs/testing/latest-summary.json",
      smoke_report: "docs/testing/e2e-smoke-report.md",
      smoke_report_json: "docs/testing/e2e-smoke-report.json",
      demo_report: "docs/testing/demo-rehearsal-report.md",
      artifacts_root: "docs/testing/artifacts",
    },
  };

  const markdown = [
    "# QA Latest Summary",
    "",
    `- Generated: ${jsonSummary.generated_at}`,
    `- Base URL: ${BASE_URL}`,
    `- Tenant ID: ${TENANT_ID || "(missing)"}`,
    `- OpenAI Runtime: ${openAiRuntime}`,
    `- Final Decision: ${overall}`,
    `- Passed Gates: ${jsonSummary.passed}`,
    `- Failed Gates: ${jsonSummary.failed}`,
    "",
    "## Gate Results",
    "",
    "| Gate | Status | Duration (ms) | Command |",
    "| --- | --- | ---: | --- |",
    ...gates.map(
      (gate) =>
        `| ${gate.name} | ${gate.status.toUpperCase()} | ${gate.duration_ms} | ${gate.command ?? "(n/a)"} |`
    ),
    "",
    "## Read First",
    "",
    "- `docs/testing/latest-summary.md`",
    "",
    "## Deep Debug (if needed)",
    "",
    "- `docs/testing/e2e-smoke-report.md`",
    "- `docs/testing/e2e-smoke-report.json`",
    "- `docs/testing/demo-rehearsal-report.md`",
    "- `docs/testing/artifacts/`",
  ];

  if (failedGates.length > 0) {
    markdown.push("", "## First Failing Gates", "");
    for (const gate of failedGates.slice(0, 5)) {
      markdown.push(`- **${gate.name}**`);
      if (gate.details) {
        markdown.push(`  - details: \`${JSON.stringify(gate.details).slice(0, 600)}\``);
      }
    }
  }

  await writeFile(SUMMARY_JSON_PATH, `${JSON.stringify(jsonSummary, null, 2)}\n`, "utf8");
  await writeFile(SUMMARY_MD_PATH, `${markdown.join("\n")}\n`, "utf8");

  return failedGates.length === 0;
}

async function updateRuntimeFromSmokeReport() {
  const smokeJsonPath = path.resolve(TESTING_DIR, "e2e-smoke-report.json");

  try {
    const raw = await readFile(smokeJsonPath, "utf8");
    const parsed = JSON.parse(raw);
    const runtimeValue =
      typeof parsed?.openai_runtime === "string" ? parsed.openai_runtime : "";
    const runtimeLower = runtimeValue.toLowerCase();

    if (runtimeLower.includes("real openai")) {
      openAiRuntime = "real";
      return;
    }

    if (runtimeLower.includes("fallback")) {
      openAiRuntime = "fallback";
      return;
    }

    if (runtimeValue.trim()) {
      if (
        runtimeLower.includes("unknown") &&
        OPENAI_RUNTIME_HINT === "fallback"
      ) {
        openAiRuntime = "fallback";
      } else {
        openAiRuntime = runtimeValue.trim();
      }
    }
  } catch {
    // Keep env hint when smoke report is unavailable.
  }
}

async function run() {
  const preflightStart = Date.now();

  const major = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  const preflightFailures = [];

  if (!Number.isFinite(major) || major < 20) {
    preflightFailures.push(`Node.js >= 20 required. Current: ${process.versions.node}`);
  }

  if (!TENANT_ID) {
    preflightFailures.push("Missing SMOKE_TENANT_ID.");
  }

  addGate(
    "preflight",
    preflightFailures.length === 0 ? "pass" : "fail",
    durationMs(preflightStart),
    {
      node: process.versions.node,
      tenant_id_present: Boolean(TENANT_ID),
      openai_runtime_hint: OPENAI_RUNTIME_HINT,
      failures: preflightFailures,
    }
  );

  if (preflightFailures.length > 0) {
    await writeSummary();
    process.exit(1);
  }

  const lint = await runCommand("lint", "npm", ["--workspace", "apps/web", "run", "lint"]);
  if (!lint.ok) {
    await writeSummary();
    process.exit(1);
  }

  const build = await runCommand("build", "npm", ["--workspace", "apps/web", "run", "build"]);
  if (!build.ok) {
    await writeSummary();
    process.exit(1);
  }

  const serverReady = await startServer();
  if (!serverReady) {
    await stopServer();
    await writeSummary();
    process.exit(1);
  }

  try {
    await runCommand("e2e smoke", "npm", ["run", "qa:e2e-smoke"], {
      env: {
        SMOKE_BASE_URL: BASE_URL,
        SMOKE_TENANT_ID: TENANT_ID,
      },
    });
    await updateRuntimeFromSmokeReport();

    await runCommand("demo rehearsal", "npm", ["run", "qa:demo-rehearsal"], {
      env: {
        BASE_URL,
        SMOKE_TENANT_ID: TENANT_ID,
      },
    });

    await runHttpCheck(
      "check /api/recommend missing tenant => 400",
      "/api/recommend",
      { user_message: "show rugs" },
      400
    );

    await runHttpCheck(
      "check /api/recommend malformed constraints => 400",
      "/api/recommend",
      {
        tenant_id: TENANT_ID,
        user_message: "show rugs",
        constraints: "bad",
      },
      400
    );

    await runHttpCheck(
      "check /api/chat role mismatch => 403",
      "/api/chat",
      {
        role: "store_staff",
        tenant_id: TENANT_ID,
        message: "show rugs",
      },
      403,
      {
        Cookie: "rug_ui_role=retail_customer",
      }
    );

    await runHttpCheck(
      "check /api/appraisal/generate non-staff => 403",
      "/api/appraisal/generate",
      {
        role: "retail_customer",
        tenant_id: TENANT_ID,
        appraisal_context: {
          customer_name: "QA",
          rug_label: "Sample",
        },
      },
      403
    );

    await cleanupOldArtifacts();
  } finally {
    await stopServer();
  }

  const ok = await writeSummary();
  process.exit(ok ? 0 : 1);
}

run().catch(async (error) => {
  addGate("qa:all internal error", "fail", 0, {
    error: error instanceof Error ? error.message : String(error),
  });

  try {
    await stopServer();
  } catch {
    // Ignore shutdown errors.
  }

  await writeSummary();
  process.exit(1);
});
