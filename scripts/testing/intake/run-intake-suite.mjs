#!/usr/bin/env node

import { spawn } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import {
  nowIso,
  readArgValue,
  readJsonSafe,
  resolveArtifactRoot,
  writeJson,
  writeText,
  requireTenantId,
} from "./common.mjs";

const args = process.argv.slice(2);
const baseUrl = readArgValue(args, "--base-url") ?? "http://127.0.0.1:3100";
const runId = readArgValue(args, "--run-id") ?? `intake-suite-${Date.now()}`;
const cycle = readArgValue(args, "--cycle") ?? null;
const tenantId = requireTenantId();

const artifactRoot = resolveArtifactRoot(runId);
const latestMdPath = path.resolve(
  process.cwd(),
  "scripts/testing/intake/latest-intake.md"
);
const latestJsonPath = path.resolve(
  process.cwd(),
  "scripts/testing/intake/latest-intake.json"
);
const suiteReportPath = path.resolve(artifactRoot, "suite-report.md");
const suiteJsonPath = path.resolve(artifactRoot, "suite-report.json");

function suiteJsonFile(name) {
  return path.resolve(artifactRoot, name, "report.json");
}

async function runCommand(name, command, commandArgs) {
  const started = Date.now();
  const child = spawn(command, commandArgs, {
    env: {
      ...process.env,
      TENANT_ID: tenantId,
      QA_MODE: process.env.QA_MODE ?? "1",
    },
    stdio: "inherit",
  });

  const [code] = await once(child, "close");
  return {
    name,
    code: typeof code === "number" ? code : 1,
    duration_ms: Date.now() - started,
    ok: code === 0,
  };
}

async function run() {
  const suites = [
    {
      name: "api-contract",
      command: "node",
      args: [
        "scripts/testing/intake/api-contract.mjs",
        "--base-url",
        baseUrl,
        "--run-id",
        runId,
      ],
      jsonPath: suiteJsonFile("api-contract"),
    },
    {
      name: "rollback",
      command: "node",
      args: [
        "scripts/testing/intake/rollback.mjs",
        "--base-url",
        baseUrl,
        "--run-id",
        runId,
      ],
      jsonPath: suiteJsonFile("rollback"),
    },
    {
      name: "integration",
      command: "node",
      args: [
        "scripts/testing/intake/integration.mjs",
        "--base-url",
        baseUrl,
        "--run-id",
        runId,
      ],
      jsonPath: suiteJsonFile("integration"),
    },
    {
      name: "ui-e2e",
      command: "node",
      args: [
        "scripts/testing/intake/ui-e2e.mjs",
        "--base-url",
        baseUrl,
        "--run-id",
        runId,
      ],
      jsonPath: suiteJsonFile("ui-e2e"),
    },
    {
      name: "property-validation",
      command: "npx",
      args: [
        "tsx",
        "scripts/testing/intake/property-validation.ts",
        "--base-url",
        baseUrl,
        "--run-id",
        runId,
      ],
      jsonPath: suiteJsonFile("property-validation"),
    },
  ];

  const execution = [];
  for (const suite of suites) {
    console.log(`\\n[INTAKE SUITE] Running ${suite.name}...`);
    const result = await runCommand(suite.name, suite.command, suite.args);
    execution.push({
      ...result,
      jsonPath: suite.jsonPath,
    });
    if (!result.ok) {
      console.log(`[INTAKE SUITE] ${suite.name} failed with exit code ${result.code}.`);
    }
  }

  const suiteSummaries = [];
  for (const suite of suites) {
    const parsed = await readJsonSafe(suite.jsonPath);
    const summary = parsed?.summary ?? null;
    suiteSummaries.push({
      name: suite.name,
      json_path: suite.jsonPath,
      summary,
      generated_at: parsed?.generated_at ?? null,
      has_report: Boolean(parsed),
    });
  }

  const failedSuites = execution.filter((row) => !row.ok).map((row) => row.name);

  const failedP0 = suiteSummaries.reduce(
    (sum, suite) => sum + Number(suite.summary?.failedBySeverity?.P0 ?? 0),
    0
  );
  const failedP1 = suiteSummaries.reduce(
    (sum, suite) => sum + Number(suite.summary?.failedBySeverity?.P1 ?? 0),
    0
  );

  const passedChecks = suiteSummaries.reduce(
    (sum, suite) => sum + Number(suite.summary?.passed ?? 0),
    0
  );
  const failedChecks = suiteSummaries.reduce(
    (sum, suite) => sum + Number(suite.summary?.failed ?? 0),
    0
  );

  const passedAll = failedSuites.length === 0 && failedChecks === 0;

  const output = {
    generated_at: nowIso(),
    run_id: runId,
    cycle,
    base_url: baseUrl,
    tenant_id: tenantId,
    artifact_root: artifactRoot,
    passed_all: passedAll,
    open_p0_p1: failedP0 + failedP1,
    failed_suites: failedSuites,
    checks: {
      passed: passedChecks,
      failed: failedChecks,
      failed_by_severity: {
        P0: failedP0,
        P1: failedP1,
      },
    },
    suite_execution: execution,
    suite_summaries: suiteSummaries,
  };

  const mdLines = [
    "# Intake Matrix Suite (Latest)",
    "",
    `- Generated: ${output.generated_at}`,
    `- Run ID: ${runId}`,
    `- Cycle: ${cycle ?? "n/a"}`,
    `- Base URL: ${baseUrl}`,
    `- Tenant ID: ${tenantId}`,
    `- Passed all suites: ${passedAll}`,
    `- Open P0/P1: ${output.open_p0_p1}`,
    `- Total checks passed: ${passedChecks}`,
    `- Total checks failed: ${failedChecks}`,
    `- Artifact root: ${artifactRoot}`,
    "",
    "| Suite | Status | Duration (ms) | Report JSON |",
    "| --- | --- | --- | --- |",
    ...execution.map((item) => {
      const summary = suiteSummaries.find((row) => row.name === item.name);
      return `| ${item.name} | ${item.ok ? "PASS" : "FAIL"} | ${item.duration_ms} | ${summary?.json_path ?? "-"} |`;
    }),
  ];

  if (failedSuites.length > 0) {
    mdLines.push("", `- Failed suites: ${failedSuites.join(", ")}`);
  }

  await writeJson(suiteJsonPath, output);
  await writeText(suiteReportPath, `${mdLines.join("\n")}\n`);
  await writeJson(latestJsonPath, output);
  await writeText(latestMdPath, `${mdLines.join("\n")}\n`);

  console.log(`INTAKE SUITE ${passedAll ? "PASS" : "FAIL"}: ${passedChecks}/${passedChecks + failedChecks}`);
  console.log(`Output: ${latestMdPath}`);

  if (!passedAll) {
    process.exit(1);
  }
}

run().catch(async (error) => {
  const output = {
    generated_at: nowIso(),
    run_id: runId,
    cycle,
    base_url: baseUrl,
    tenant_id: tenantId,
    passed_all: false,
    open_p0_p1: 1,
    failed_suites: ["run-intake-suite"],
    checks: {
      passed: 0,
      failed: 1,
      failed_by_severity: {
        P0: 1,
        P1: 0,
      },
    },
    error: error instanceof Error ? error.message : String(error),
  };
  await writeJson(latestJsonPath, output);
  await writeText(
    latestMdPath,
    `# Intake Matrix Suite (Latest)\n\n- Generated: ${nowIso()}\n- Error: ${output.error}\n`
  );
  console.error(error);
  process.exit(1);
});
