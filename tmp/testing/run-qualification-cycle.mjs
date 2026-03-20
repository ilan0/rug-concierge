import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  DEFAULT_LOCAL_BASE_URL,
  DEFAULT_PRODUCTION_BASE_URL,
  loadEnvLocal,
  nowIso,
  nowTag,
  parseArgs,
  writeReport,
} from "./lib/common.mjs";

const REPORTS_DIR = path.resolve("tmp/testing/reports");
const FINAL_REPORT_PATH = path.resolve("tmp/testing/final-go-no-go.md");
const MANIFEST_PATH = path.resolve("tmp/testing/manifests/manifest-real-60.json");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runCommand(input) {
  return new Promise((resolve) => {
    const child = spawn(input.command, input.args, {
      cwd: input.cwd ?? process.cwd(),
      env: {
        ...process.env,
        ...(input.env ?? {}),
      },
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      stdout += text;
      process.stdout.write(text);
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      stderr += text;
      process.stderr.write(text);
    });
    child.on("close", (code) => {
      resolve({
        code: typeof code === "number" ? code : 1,
        stdout,
        stderr,
      });
    });
  });
}

async function startLocalServer(env) {
  const child = spawn("npm", ["--workspace", "apps/web", "run", "dev", "--", "--port", "4201"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  });

  let bootLogs = "";
  child.stdout.on("data", (chunk) => {
    const text = chunk.toString("utf8");
    bootLogs += text;
    process.stdout.write(text);
  });
  child.stderr.on("data", (chunk) => {
    const text = chunk.toString("utf8");
    bootLogs += text;
    process.stderr.write(text);
  });

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (bootLogs.includes("Ready in") || bootLogs.includes("Local:")) {
      return child;
    }
    await sleep(300);
  }

  child.kill("SIGINT");
  throw new Error("Local dev server failed to start within 60 seconds.");
}

async function stopLocalServer(child) {
  if (!child || child.killed) return;
  child.kill("SIGINT");
  await sleep(700);
}

function parseJsonMaybe(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function ensureManifest() {
  try {
    await fs.access(MANIFEST_PATH);
    return MANIFEST_PATH;
  } catch {
    const result = await runCommand({
      command: "node",
      args: ["tmp/testing/build-manifest-real-60.mjs"],
    });
    if (result.code !== 0) {
      throw new Error("Failed to generate manifest-real-60.json");
    }
    return MANIFEST_PATH;
  }
}

async function runCycle(input) {
  const cycleTag = `cycle-${input.cycleNumber}-${nowTag()}`;
  const artifacts = [];
  const failures = [];
  const env = await loadEnvLocal();
  const tenantId = String(env.TENANT_ID ?? "").trim();
  const cronSecret = String(env.CRON_SECRET ?? "").trim();
  const vercelToken = String(env.VERCEL_TOKEN ?? "").trim();

  const recordResult = async (label, result, reportPath) => {
    const payload = {
      generated_at: nowIso(),
      cycle: input.cycleNumber,
      label,
      command: result.command,
      args: result.args,
      code: result.exec.code,
      ok: result.exec.code === 0,
      report_path: reportPath ?? null,
      stdout: result.exec.stdout,
      stderr: result.exec.stderr,
    };
    const metadataPath = path.resolve(REPORTS_DIR, `cmd-${label}-${cycleTag}.json`);
    await writeReport(metadataPath, payload);
    artifacts.push(metadataPath);
    if (reportPath) {
      artifacts.push(reportPath);
    }
    if (result.exec.code !== 0) {
      failures.push({ label, report: reportPath ?? metadataPath });
    }
  };

  const runAndRecord = async (label, command, args, extra = {}) => {
    const exec = await runCommand({
      command,
      args,
      env: extra.env,
      cwd: extra.cwd,
    });
    await recordResult(
      label,
      {
        command,
        args,
        exec,
      },
      extra.reportPath
    );
    return exec;
  };

  // Phase 0: purge + manifest.
  await runAndRecord("purge-before-local", "npx", [
    "tsx",
    "scripts/purge-tenant-inventory.ts",
    `--tenant-id=${tenantId}`,
    "--apply",
  ]);
  const manifestPath = await ensureManifest();
  artifacts.push(manifestPath);

  // Phase 1 + 2 local
  const localServer = await startLocalServer({
    CRON_SECRET: cronSecret,
  });

  try {
    await runAndRecord("unit-tests", "npm", ["--workspace", "apps/web", "run", "test:unit"]);

    const playwrightReportPath = path.resolve(
      REPORTS_DIR,
      `e2e-playwright-${cycleTag}.json`
    );
    const e2eExec = await runCommand({
      command: "npm",
      args: ["--workspace", "apps/web", "exec", "playwright", "test", "--reporter=json"],
    });
    await writeReport(playwrightReportPath, parseJsonMaybe(e2eExec.stdout) ?? {
      generated_at: nowIso(),
      ok: false,
      reason: "playwright_json_parse_failed",
      stdout: e2eExec.stdout,
      stderr: e2eExec.stderr,
      code: e2eExec.code,
    });
    artifacts.push(playwrightReportPath);
    if (e2eExec.code !== 0) {
      failures.push({ label: "playwright", report: playwrightReportPath });
    }

    const contractReportPath = path.resolve(
      REPORTS_DIR,
      `contract-report-${cycleTag}-local.json`
    );
    await runAndRecord(
      "contract-local",
      "node",
      [
        "tmp/testing/contract-suite.mjs",
        `--base_url=${DEFAULT_LOCAL_BASE_URL}`,
        "--skip_rate_limit=1",
        `--report=${contractReportPath}`,
      ],
      { reportPath: contractReportPath }
    );

    const liveSmokeExec = await runCommand({
      command: "node",
      args: ["tmp/testing/live-endpoint-smoke.mjs"],
      env: {
        CRON_SECRET: cronSecret,
        SMOKE_BASE_URL: DEFAULT_LOCAL_BASE_URL,
      },
    });
    const liveSmokePath = path.resolve(REPORTS_DIR, `live-smoke-${cycleTag}.json`);
    await writeReport(liveSmokePath, {
      generated_at: nowIso(),
      cycle: input.cycleNumber,
      label: "live-smoke-local",
      base_url: DEFAULT_LOCAL_BASE_URL,
      code: liveSmokeExec.code,
      ok: liveSmokeExec.code === 0,
      stdout: liveSmokeExec.stdout,
      stderr: liveSmokeExec.stderr,
    });
    artifacts.push(liveSmokePath);
    if (liveSmokeExec.code !== 0) {
      failures.push({ label: "live-smoke", report: liveSmokePath });
    }

    const edgeExec = await runCommand({
      command: "node",
      args: ["tmp/testing/edge-worker-checks.mjs"],
      env: {
        CRON_SECRET: cronSecret,
        EDGE_BASE_URL: DEFAULT_LOCAL_BASE_URL,
      },
    });
    const edgePath = path.resolve(REPORTS_DIR, `edge-worker-${cycleTag}.json`);
    await writeReport(edgePath, {
      generated_at: nowIso(),
      cycle: input.cycleNumber,
      label: "edge-worker-local",
      base_url: DEFAULT_LOCAL_BASE_URL,
      code: edgeExec.code,
      ok: edgeExec.code === 0,
      stdout: edgeExec.stdout,
      stderr: edgeExec.stderr,
    });
    artifacts.push(edgePath);
    if (edgeExec.code !== 0) {
      failures.push({ label: "edge-worker", report: edgePath });
    }

    const localRunReport = path.resolve(
      REPORTS_DIR,
      `golden-run-report-local-${cycleTag}.json`
    );
    await runAndRecord(
      "real-images-local",
      "node",
      [
        "tmp/testing/run-real-image-intake.mjs",
        `--base_url=${DEFAULT_LOCAL_BASE_URL}`,
        "--label=local",
        `--manifest=${manifestPath}`,
        `--forwarded_for_base=172.31.${100 + input.cycleNumber}`,
        "--rate_limit_wait_ms=70000",
        "--request_spacing_ms=0",
        `--report=${localRunReport}`,
      ],
      { reportPath: localRunReport }
    );

    const localQualityPath = path.resolve(
      REPORTS_DIR,
      `quality-audit-local-${cycleTag}.json`
    );
    await runAndRecord(
      "quality-audit-local",
      "node",
      [
        "tmp/testing/quality-auditor.mjs",
        "--mode=local",
        `--manifest=${manifestPath}`,
        `--run_report=${localRunReport}`,
        `--report=${localQualityPath}`,
      ],
      { reportPath: localQualityPath }
    );
  } finally {
    await stopLocalServer(localServer);
  }

  // Phase 3 production parity
  await runAndRecord("purge-before-prod", "npx", [
    "tsx",
    "scripts/purge-tenant-inventory.ts",
    `--tenant-id=${tenantId}`,
    "--apply",
  ]);

  const prodContractPath = path.resolve(
    REPORTS_DIR,
    `contract-report-${cycleTag}-prod.json`
  );
  await runAndRecord(
    "contract-prod",
    "node",
    [
      "tmp/testing/contract-suite.mjs",
      `--base_url=${DEFAULT_PRODUCTION_BASE_URL}`,
      "--skip_rate_limit=1",
      `--report=${prodContractPath}`,
    ],
    { reportPath: prodContractPath }
  );

  const prodRunReport = path.resolve(
    REPORTS_DIR,
    `golden-run-report-prod-${cycleTag}.json`
  );
  await runAndRecord(
    "real-images-prod",
    "node",
    [
      "tmp/testing/run-real-image-intake.mjs",
      `--base_url=${DEFAULT_PRODUCTION_BASE_URL}`,
      "--label=prod",
      `--manifest=${manifestPath}`,
      `--forwarded_for_base=172.32.${100 + input.cycleNumber}`,
      "--rate_limit_wait_ms=70000",
      "--request_spacing_ms=2200",
      `--report=${prodRunReport}`,
    ],
    { reportPath: prodRunReport }
  );

  const prodQualityPath = path.resolve(
    REPORTS_DIR,
    `quality-audit-prod-${cycleTag}.json`
  );
  await runAndRecord(
    "quality-audit-prod",
    "node",
    [
      "tmp/testing/quality-auditor.mjs",
      "--mode=prod",
      `--manifest=${manifestPath}`,
      `--run_report=${prodRunReport}`,
      `--report=${prodQualityPath}`,
    ],
    { reportPath: prodQualityPath }
  );

  const cycleSummaryPath = path.resolve(REPORTS_DIR, `cycle-summary-${cycleTag}.json`);
  const cycleSummary = {
    generated_at: nowIso(),
    cycle: input.cycleNumber,
    failures,
    artifacts,
    pass: failures.length === 0,
  };
  await writeReport(cycleSummaryPath, cycleSummary);
  artifacts.push(cycleSummaryPath);

  return {
    pass: failures.length === 0,
    failures,
    artifacts,
    cycleSummaryPath,
    cycleTag,
    metadata: {
      tenant_id: tenantId,
      production_url: DEFAULT_PRODUCTION_BASE_URL,
      local_url: DEFAULT_LOCAL_BASE_URL,
      has_vercel_token: Boolean(vercelToken),
    },
  };
}

async function writeFinalGoNoGo(input) {
  const blockers = [];
  if (!input.finalPass) {
    blockers.push("Two consecutive fully green cycles were not achieved.");
  }
  for (const cycle of input.cycles) {
    if (cycle.pass) continue;
    for (const failure of cycle.failures) {
      blockers.push(`Cycle ${cycle.index}: ${failure.label} (report: ${failure.report})`);
    }
  }

  const content = [
    "# Intake Qualification Go/No-Go",
    "",
    `- Generated: ${nowIso()}`,
    `- Consecutive green cycles required: 2`,
    `- Consecutive green cycles achieved: ${input.consecutiveGreens}`,
    `- Final status: ${input.finalPass ? "GO" : "NO-GO"}`,
    "",
    "## Cycle Results",
    ...input.cycles.map(
      (cycle) =>
        `- Cycle ${cycle.index}: ${cycle.pass ? "PASS" : "FAIL"} (${cycle.summaryPath})`
    ),
    "",
    "## Blockers",
    ...(blockers.length > 0 ? blockers.map((item) => `- ${item}`) : ["- None"]),
  ].join("\n");

  await fs.writeFile(FINAL_REPORT_PATH, content, "utf8");
}

async function main() {
  await fs.mkdir(REPORTS_DIR, { recursive: true });
  const args = parseArgs(process.argv.slice(2));
  const maxCycles = Math.max(1, Number.parseInt(args.max_cycles ?? "4", 10));
  const requiredConsecutiveGreens = 2;

  let consecutiveGreens = 0;
  const cycles = [];

  for (let cycleIndex = 1; cycleIndex <= maxCycles; cycleIndex += 1) {
    const cycle = await runCycle({ cycleNumber: cycleIndex });
    cycles.push({
      index: cycleIndex,
      pass: cycle.pass,
      failures: cycle.failures,
      artifacts: cycle.artifacts,
      summaryPath: cycle.cycleSummaryPath,
    });

    if (cycle.pass) {
      consecutiveGreens += 1;
    } else {
      consecutiveGreens = 0;
    }

    if (consecutiveGreens >= requiredConsecutiveGreens) {
      break;
    }
  }

  const finalPass = consecutiveGreens >= requiredConsecutiveGreens;
  await writeFinalGoNoGo({
    finalPass,
    cycles,
    consecutiveGreens,
  });

  console.log(
    JSON.stringify(
      {
        ok: finalPass,
        final_report: FINAL_REPORT_PATH,
        cycles_run: cycles.length,
        consecutive_greens: consecutiveGreens,
      },
      null,
      2
    )
  );

  process.exit(finalPass ? 0 : 1);
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2
    )
  );
  process.exit(1);
});
