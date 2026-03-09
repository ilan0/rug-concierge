#!/usr/bin/env node

import { spawn } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import {
  nowIso,
  readArgInt,
  readArgValue,
  readJsonSafe,
  requireTenantId,
  writeJson,
  writeText,
} from "./common.mjs";

const args = process.argv.slice(2);
const maxCycles = Math.min(Math.max(readArgInt(args, "--max-cycles", 10), 1), 10);
const tenantId = requireTenantId();
const loopRunId = readArgValue(args, "--loop-run-id") ?? `intake-loop-${Date.now()}`;

const intakeLatestJson = path.resolve(
  process.cwd(),
  "scripts/testing/intake/latest-intake.json"
);
const loopLatestMd = path.resolve(
  process.cwd(),
  "scripts/testing/intake/latest-intake-loop.md"
);
const loopLatestJson = path.resolve(
  process.cwd(),
  "scripts/testing/intake/latest-intake-loop.json"
);
const blockerPath = path.resolve(
  process.cwd(),
  "scripts/testing/intake/latest-intake-blocker.md"
);

async function runCommand(name, argsList) {
  const startedAt = Date.now();
  const child = spawn("node", argsList, {
    env: {
      ...process.env,
      TENANT_ID: tenantId,
      QA_MODE: "1",
    },
    stdio: "inherit",
  });
  const [code] = await once(child, "close");
  return {
    name,
    ok: code === 0,
    code: typeof code === "number" ? code : 1,
    duration_ms: Date.now() - startedAt,
  };
}

function renderLoopMarkdown(summary) {
  const lines = [
    "# Intake Iterative Loop (Latest)",
    "",
    `- Generated: ${summary.generated_at}`,
    `- Loop Run ID: ${summary.loop_run_id}`,
    `- Tenant ID: ${summary.tenant_id}`,
    `- Max cycles: ${summary.max_cycles}`,
    `- Executed cycles: ${summary.executed_cycles}`,
    `- Gate passed: ${summary.gate_passed}`,
    `- Gate pass cycle: ${summary.gate_pass_cycle ?? "n/a"}`,
    `- Final streaks: intake=${summary.streaks.intake}, functional=${summary.streaks.functional}, quality=${summary.streaks.quality}`,
    `- Open P0/P1 (latest intake): ${summary.latest_open_p0_p1 ?? "unknown"}`,
    "",
    "| Cycle | Intake | Functional | Quality | Streaks (I/F/Q) | Open P0/P1 |",
    "| --- | --- | --- | --- | --- | --- |",
    ...summary.cycles.map(
      (cycle) =>
        `| ${cycle.cycle} | ${cycle.intake.ok ? "PASS" : "FAIL"} | ${
          cycle.functional.ok ? "PASS" : "FAIL"
        } | ${cycle.quality.ok ? "PASS" : "FAIL"} | ${cycle.streaks.intake}/${cycle.streaks.functional}/${cycle.streaks.quality} | ${cycle.intake_open_p0_p1 ?? "n/a"} |`
    ),
  ];

  if (!summary.gate_passed) {
    lines.push(
      "",
      "## Blocker",
      `- See ${blockerPath}`
    );
  }

  return `${lines.join("\n")}\n`;
}

async function writeBlocker(summary) {
  const latestCycle = summary.cycles[summary.cycles.length - 1] ?? null;
  const lines = [
    "# Intake Loop Blocker Report",
    "",
    `- Generated: ${summary.generated_at}`,
    `- Loop Run ID: ${summary.loop_run_id}`,
    `- Max cycles reached: ${summary.max_cycles}`,
    `- Gate passed: ${summary.gate_passed}`,
    `- Final streaks: intake=${summary.streaks.intake}, functional=${summary.streaks.functional}, quality=${summary.streaks.quality}`,
    `- Latest intake open P0/P1: ${summary.latest_open_p0_p1 ?? "unknown"}`,
    "",
    "## Latest Cycle Evidence",
    latestCycle
      ? `- Cycle ${latestCycle.cycle}: intake=${latestCycle.intake.ok ? "PASS" : "FAIL"}, functional=${
          latestCycle.functional.ok ? "PASS" : "FAIL"
        }, quality=${latestCycle.quality.ok ? "PASS" : "FAIL"}`
      : "- No cycle data available.",
    latestCycle ? `- Intake run id: ${latestCycle.intake_run_id}` : "",
    latestCycle ? `- Intake open P0/P1: ${latestCycle.intake_open_p0_p1 ?? "unknown"}` : "",
    "",
    "## Remediation Options",
    "1. Inspect `scripts/testing/intake/latest-intake.md` and per-suite reports under `docs/testing/artifacts/intake/<run-id>/`.",
    "2. Fix top-severity failing checks first (P0/P1), rerun `npm run qa:functional` and `npm run qa:quality`.",
    "3. If failures are flaky, isolate with direct suite command (`node scripts/testing/intake/run-intake-suite.mjs --base-url ... --run-id ...`).",
  ].filter(Boolean);

  await writeText(blockerPath, `${lines.join("\n")}\n`);
}

async function run() {
  const cycles = [];
  const streaks = {
    intake: 0,
    functional: 0,
    quality: 0,
  };

  let gatePassed = false;
  let gatePassCycle = null;
  let latestOpenP0P1 = null;

  for (let cycle = 1; cycle <= maxCycles; cycle += 1) {
    const intakeRunId = `${loopRunId}-cycle-${cycle}`;
    console.log(`\\n[INTAKE LOOP] Cycle ${cycle}/${maxCycles}`);

    const functional = await runCommand("functional", ["scripts/qa.mjs", "functional"]);

    const intakeLatest = await readJsonSafe(intakeLatestJson);
    const intakeOpenP0P1 =
      intakeLatest && typeof intakeLatest.open_p0_p1 === "number"
        ? intakeLatest.open_p0_p1
        : null;
    latestOpenP0P1 = intakeOpenP0P1;

    const intake = {
      name: "intake",
      ok: functional.ok && intakeOpenP0P1 === 0,
      code: functional.code,
      duration_ms: functional.duration_ms,
    };
    const quality = await runCommand("quality", ["scripts/qa.mjs", "quality"]);

    streaks.intake = intake.ok ? streaks.intake + 1 : 0;
    streaks.functional = functional.ok ? streaks.functional + 1 : 0;
    streaks.quality = quality.ok ? streaks.quality + 1 : 0;

    const cycleRecord = {
      cycle,
      intake_run_id: intakeRunId,
      intake,
      functional,
      quality,
      intake_open_p0_p1: intakeOpenP0P1,
      streaks: {
        ...streaks,
      },
    };
    cycles.push(cycleRecord);

    const cycleGatePassed =
      streaks.intake >= 2 &&
      streaks.functional >= 2 &&
      streaks.quality >= 2 &&
      intakeOpenP0P1 === 0;

    if (cycleGatePassed) {
      gatePassed = true;
      gatePassCycle = cycle;
      break;
    }
  }

  const summary = {
    generated_at: nowIso(),
    loop_run_id: loopRunId,
    tenant_id: tenantId,
    max_cycles: maxCycles,
    executed_cycles: cycles.length,
    gate_passed: gatePassed,
    gate_pass_cycle: gatePassCycle,
    latest_open_p0_p1: latestOpenP0P1,
    streaks,
    cycles,
  };

  await writeJson(loopLatestJson, summary);
  await writeText(loopLatestMd, renderLoopMarkdown(summary));

  if (!gatePassed) {
    await writeBlocker(summary);
  }

  console.log(`INTAKE LOOP ${gatePassed ? "PASS" : "FAIL"}: cycles=${cycles.length}`);
  console.log(`Output: ${loopLatestMd}`);

  if (!gatePassed) {
    process.exit(1);
  }
}

run().catch(async (error) => {
  const summary = {
    generated_at: nowIso(),
    loop_run_id: loopRunId,
    tenant_id: tenantId,
    max_cycles: maxCycles,
    executed_cycles: 0,
    gate_passed: false,
    gate_pass_cycle: null,
    latest_open_p0_p1: null,
    streaks: {
      intake: 0,
      functional: 0,
      quality: 0,
    },
    cycles: [],
    error: error instanceof Error ? error.message : String(error),
  };
  await writeJson(loopLatestJson, summary);
  await writeText(
    loopLatestMd,
    `# Intake Iterative Loop (Latest)\n\n- Generated: ${nowIso()}\n- Error: ${summary.error}\n`
  );
  console.error(error);
  process.exit(1);
});
