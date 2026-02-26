#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const baseUrl = readArg("--base-url") ?? "http://127.0.0.1:3100";
const casesPath = path.resolve(
  process.cwd(),
  readArg("--cases") ?? "scripts/testing/quality/chat-check.ndjson"
);
const tenantId = (process.env.TENANT_ID ?? "").trim();
const outputPath = path.resolve(process.cwd(), "scripts/testing/quality/latest.md");

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

function resolveTemplate(value) {
  if (value === "$TENANT_ID") return tenantId;
  return value;
}

function readBool(v) {
  return Boolean(v);
}

function isExpected(value, expected, expectedIn) {
  if (expectedIn && Array.isArray(expectedIn)) return expectedIn.includes(value);
  if (expected !== undefined) return value === expected;
  return true;
}

async function loadCases(filePath) {
  const raw = await readFile(filePath, "utf8");
  const lines = raw.split(/\r?\n/).map((line) => line.trim());
  const cases = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line || line.startsWith("#")) continue;
    cases.push(JSON.parse(line));
  }

  return cases;
}

async function postChat(body, cookie) {
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
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

function evaluateTurn(expect, response) {
  const checks = [];
  const push = (name, pass, details = null) => checks.push({ name, pass, details });

  if (!expect || typeof expect !== "object") {
    push("no expectation", true);
    return checks;
  }

  if (typeof expect.status === "number") {
    push("status", response.status === expect.status, {
      expected: expect.status,
      actual: response.status,
    });
  }

  const coarse = response.json?.mode;
  const fine = response.json?.fine_mode;
  const responseMode = response.json?.response?.mode;
  const recommendations = Array.isArray(response.json?.response?.recommendations)
    ? response.json.response.recommendations.length
    : 0;
  const questions = Array.isArray(response.json?.response?.questions)
    ? response.json.response.questions.length
    : 0;
  const followUp = response.json?.response?.follow_up_question;

  push(
    "coarse_mode",
    isExpected(coarse, expect.coarse_mode, expect.coarse_mode_in),
    { expected: expect.coarse_mode ?? expect.coarse_mode_in, actual: coarse }
  );
  push(
    "fine_mode",
    isExpected(fine, expect.fine_mode, expect.fine_mode_in),
    { expected: expect.fine_mode ?? expect.fine_mode_in, actual: fine }
  );
  push(
    "response_mode",
    isExpected(responseMode, expect.response_mode, expect.response_mode_in),
    { expected: expect.response_mode ?? expect.response_mode_in, actual: responseMode }
  );

  if (typeof expect.recommendations_min === "number") {
    push("recommendations_min", recommendations >= expect.recommendations_min, {
      expected_min: expect.recommendations_min,
      actual: recommendations,
    });
  }

  if (typeof expect.questions_min === "number") {
    push("questions_min", questions >= expect.questions_min, {
      expected_min: expect.questions_min,
      actual: questions,
    });
  }

  if (typeof expect.follow_up_present === "boolean") {
    push("follow_up_present", readBool(followUp) === expect.follow_up_present, {
      expected: expect.follow_up_present,
      actual: readBool(followUp),
    });
  }

  if (expect.constraints && typeof expect.constraints === "object") {
    const hard = response.json?.recommendation_state?.hard_constraints ?? {};
    const budgetPresent = typeof hard.budgetMax === "number";
    const sizePresent = Boolean(hard.size);

    if (typeof expect.constraints.budget_present === "boolean") {
      push(
        "constraints.budget_present",
        budgetPresent === expect.constraints.budget_present,
        { expected: expect.constraints.budget_present, actual: budgetPresent }
      );
    }
    if (typeof expect.constraints.size_present === "boolean") {
      push("constraints.size_present", sizePresent === expect.constraints.size_present, {
        expected: expect.constraints.size_present,
        actual: sizePresent,
      });
    }
  }

  return checks;
}

async function run() {
  const scenarios = await loadCases(casesPath);
  const results = [];

  for (const scenario of scenarios) {
    let sessionId = null;
    let scenarioPass = true;
    let firstFail = null;

    for (let i = 0; i < scenario.turns.length; i += 1) {
      const turn = scenario.turns[i];
      const role = resolveTemplate(turn.role ?? scenario.role ?? "retail_customer");
      const tenant = resolveTemplate(turn.tenant_id ?? scenario.tenant_id ?? "$TENANT_ID");
      const cookieRaw = resolveTemplate(turn.ui_role_cookie ?? scenario.start?.ui_role_cookie ?? "");
      const cookie = cookieRaw
        ? cookieRaw.includes("=")
          ? cookieRaw
          : `rug_ui_role=${cookieRaw}`
        : null;

      const requestBody = {
        role,
        ...(sessionId ? { session_id: sessionId } : {}),
        ...(tenant ? { tenant_id: tenant } : {}),
        ...(typeof turn.message === "string" ? { message: turn.message } : {}),
        ...(turn.review_action ? { review_action: turn.review_action } : {}),
      };

      const response = await postChat(requestBody, cookie);
      const jsonSession = response.json?.session_id;
      if (typeof jsonSession === "string" && jsonSession.length > 0) {
        sessionId = jsonSession;
      }

      const checks = evaluateTurn(turn.expect ?? {}, response);
      const turnPass = checks.every((check) => check.pass);

      if (!turnPass && !firstFail) {
        firstFail = {
          turn: i + 1,
          failed_checks: checks.filter((check) => !check.pass),
          status: response.status,
        };
      }

      if (!turnPass) scenarioPass = false;
    }

    results.push({
      name: scenario.name,
      pass: scenarioPass,
      first_fail: firstFail,
    });
  }

  const passed = results.filter((row) => row.pass).length;
  const failed = results.length - passed;

  const lines = [
    "# Quality Suite (Latest)",
    "",
    `- Generated: ${nowIso()}`,
    `- Base URL: ${baseUrl}`,
    `- Tenant ID: ${tenantId}`,
    `- Cases: ${results.length}`,
    `- Passed: ${passed}`,
    `- Failed: ${failed}`,
    "",
    "| Scenario | Result | First Failure |",
    "| --- | --- | --- |",
    ...results.map((row) =>
      `| ${row.name} | ${row.pass ? "PASS" : "FAIL"} | ${
        row.first_fail ? `turn ${row.first_fail.turn}: ${JSON.stringify(row.first_fail.failed_checks[0]?.details ?? {})}` : "-"
      } |`
    ),
  ];

  await writeFile(outputPath, `${lines.join("\n")}\n`, "utf8");
  console.log(`Wrote ${outputPath}`);

  if (failed > 0) process.exit(1);
}

run().catch(async (error) => {
  await writeFile(
    outputPath,
    `# Quality Suite (Latest)\n\n- Generated: ${nowIso()}\n- Error: ${
      error instanceof Error ? error.message : String(error)
    }\n`,
    "utf8"
  );
  console.error(error);
  process.exit(1);
});
