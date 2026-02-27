#!/usr/bin/env node

import { readdir, readFile, writeFile } from "node:fs/promises";
import { statSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const baseUrl = readArgValue("--base-url") ?? "http://127.0.0.1:3100";
const tenantId = (process.env.TENANT_ID ?? "").trim();
const outputPath = path.resolve(process.cwd(), "scripts/testing/quality/latest-quality.md");
const extendedMode = hasFlag("--extended");
const perTurnTimeoutMs = Number.parseInt(process.env.QA_CHAT_TIMEOUT_MS ?? "45000", 10);

if (!tenantId) {
  console.error("Missing TENANT_ID");
  process.exit(1);
}

function hasFlag(flag) {
  return args.includes(flag);
}

function readArgValue(flag) {
  const index = args.indexOf(flag);
  if (index === -1) return null;
  return args[index + 1] ?? null;
}

function readArgValues(flag) {
  const values = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] !== flag) continue;
    values.push(args[i + 1] ?? "");
  }
  return values.filter(Boolean);
}

function nowIso() {
  return new Date().toISOString();
}

function resolveTemplate(value) {
  if (value === "$TENANT_ID") return tenantId;
  return value;
}

function isExpected(value, expected, expectedIn) {
  if (Array.isArray(expectedIn)) return expectedIn.includes(value);
  if (expected !== undefined) return value === expected;
  return true;
}

function toSnippet(response) {
  const message = response.json?.response?.assistant_message;
  if (typeof message === "string" && message.trim().length > 0) {
    return message.replace(/\s+/g, " ").trim().slice(0, 180);
  }
  return String(response.raw ?? "").replace(/\s+/g, " ").trim().slice(0, 180);
}

function isDir(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

async function resolveCaseFiles() {
  const explicit = readArgValues("--cases").map((value) =>
    path.resolve(process.cwd(), value)
  );
  const files = [];

  const seeds =
    explicit.length > 0
      ? explicit
      : [path.resolve(process.cwd(), "scripts/testing/quality/chat-check.ndjson")];

  for (const seed of seeds) {
    if (isDir(seed)) {
      const entries = await readdir(seed);
      const ndjson = entries
        .filter((name) => name.endsWith(".ndjson"))
        .sort()
        .map((name) => path.resolve(seed, name));
      files.push(...ndjson);
      continue;
    }

    files.push(seed);
  }

  if (extendedMode) {
    const generated = path.resolve(
      process.cwd(),
      "scripts/testing/quality/chat-check.generated.ndjson"
    );
    files.push(generated);
  }

  return [...new Set(files)];
}

async function loadCases(filePath) {
  const raw = await readFile(filePath, "utf8");
  const lines = raw.split(/\r?\n/).map((line) => line.trim());
  const cases = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line || line.startsWith("#")) continue;
    cases.push({ ...JSON.parse(line), __source_file: filePath, __line: i + 1 });
  }

  return cases;
}

async function loadAllCases() {
  const files = await resolveCaseFiles();
  const scenarios = [];
  for (const file of files) {
    const cases = await loadCases(file);
    scenarios.push(...cases);
  }
  return { files, scenarios };
}

async function postChat(body, cookie) {
  const controller = new AbortController();
  const timeout = Number.isFinite(perTurnTimeoutMs) && perTurnTimeoutMs > 0 ? perTurnTimeoutMs : 45000;
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
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
      request_error: null,
      headers: {
        chat_route_trace_id: response.headers.get("x-chat-route-trace-id"),
        recommendation_trace_id: response.headers.get("x-recommendation-trace-id"),
        appraisal_trace_id: response.headers.get("x-appraisal-trace-id"),
      },
    };
  } catch (error) {
    const aborted =
      error instanceof Error &&
      (error.name === "AbortError" || error.message.toLowerCase().includes("aborted"));
    const message =
      aborted
        ? `Request timed out after ${timeout}ms`
        : error instanceof Error
          ? error.message
          : String(error);

    return {
      status: 0,
      json: { code: aborted ? "REQUEST_TIMEOUT" : "REQUEST_ERROR", message },
      raw: message,
      request_error: message,
      headers: {
        chat_route_trace_id: null,
        recommendation_trace_id: null,
        appraisal_trace_id: null,
      },
    };
  } finally {
    clearTimeout(timer);
  }
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

  if (Array.isArray(expect.status_in)) {
    push("status_in", expect.status_in.includes(response.status), {
      expected: expect.status_in,
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
  const assistant =
    typeof response.json?.response?.assistant_message === "string"
      ? response.json.response.assistant_message
      : "";
  const code = response.json?.code;

  if (expect.coarse_mode !== undefined || Array.isArray(expect.coarse_mode_in)) {
    push(
      "coarse_mode",
      isExpected(coarse, expect.coarse_mode, expect.coarse_mode_in),
      { expected: expect.coarse_mode ?? expect.coarse_mode_in, actual: coarse }
    );
  }

  if (expect.fine_mode !== undefined || Array.isArray(expect.fine_mode_in)) {
    push("fine_mode", isExpected(fine, expect.fine_mode, expect.fine_mode_in), {
      expected: expect.fine_mode ?? expect.fine_mode_in,
      actual: fine,
    });
  }

  if (expect.response_mode !== undefined || Array.isArray(expect.response_mode_in)) {
    push(
      "response_mode",
      isExpected(responseMode, expect.response_mode, expect.response_mode_in),
      { expected: expect.response_mode ?? expect.response_mode_in, actual: responseMode }
    );
  }

  if (typeof expect.recommendations_min === "number") {
    push("recommendations_min", recommendations >= expect.recommendations_min, {
      expected_min: expect.recommendations_min,
      actual: recommendations,
    });
  }

  if (typeof expect.recommendations_max === "number") {
    push("recommendations_max", recommendations <= expect.recommendations_max, {
      expected_max: expect.recommendations_max,
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
    push("follow_up_present", Boolean(followUp) === expect.follow_up_present, {
      expected: expect.follow_up_present,
      actual: Boolean(followUp),
    });
  }

  if (typeof expect.error_code === "string") {
    push("error_code", code === expect.error_code, {
      expected: expect.error_code,
      actual: code,
    });
  }

  if (Array.isArray(expect.assistant_contains_any)) {
    const hasAny = expect.assistant_contains_any.some(
      (token) => typeof token === "string" && token.length > 0 && assistant.includes(token)
    );
    push("assistant_contains_any", hasAny, {
      expected_any: expect.assistant_contains_any,
      actual_snippet: assistant.slice(0, 180),
    });
  }

  if (Array.isArray(expect.assistant_not_contains)) {
    for (const token of expect.assistant_not_contains) {
      if (typeof token !== "string" || token.length === 0) continue;
      push(`assistant_not_contains:${token}`, !assistant.includes(token), {
        token,
      });
    }
  }

  if (expect.constraints && typeof expect.constraints === "object") {
    const hard = response.json?.recommendation_state?.hard_constraints ?? {};
    const soft = response.json?.recommendation_state?.soft_preferences ?? {};
    const budgetPresent = typeof hard.budgetMax === "number";
    const sizePresent = Boolean(hard.size);
    const stylePresent = typeof soft.style === "string" && soft.style.trim().length > 0;
    const palettePresent =
      typeof soft.palette === "string" && soft.palette.trim().length > 0;

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
    if (typeof expect.constraints.style_present === "boolean") {
      push("constraints.style_present", stylePresent === expect.constraints.style_present, {
        expected: expect.constraints.style_present,
        actual: stylePresent,
      });
    }
    if (typeof expect.constraints.palette_present === "boolean") {
      push(
        "constraints.palette_present",
        palettePresent === expect.constraints.palette_present,
        {
          expected: expect.constraints.palette_present,
          actual: palettePresent,
        }
      );
    }
  }

  return checks;
}

function buildMessage(turn) {
  if (typeof turn.message === "string") return turn.message;
  if (turn.message_repeat && typeof turn.message_repeat === "object") {
    const text =
      typeof turn.message_repeat.text === "string" ? turn.message_repeat.text : "x";
    const count =
      typeof turn.message_repeat.count === "number" && turn.message_repeat.count > 0
        ? Math.floor(turn.message_repeat.count)
        : 1;
    return text.repeat(count);
  }
  return "";
}

async function run() {
  const { files, scenarios } = await loadAllCases();
  const results = [];

  for (const scenario of scenarios) {
    const scenarioNumber = results.length + 1;
    console.log(`[${scenarioNumber}/${scenarios.length}] ${scenario.name}`);
    let sessionId = null;
    let scenarioPass = true;
    let firstFail = null;

    for (let i = 0; i < scenario.turns.length; i += 1) {
      const turn = scenario.turns[i];
      const role = resolveTemplate(turn.role ?? scenario.role ?? "retail_customer");
      const tenant = resolveTemplate(turn.tenant_id ?? scenario.tenant_id ?? "$TENANT_ID");
      const cookieRaw = resolveTemplate(
        turn.ui_role_cookie ?? scenario.start?.ui_role_cookie ?? ""
      );
      const cookie = cookieRaw
        ? cookieRaw.includes("=")
          ? cookieRaw
          : `rug_ui_role=${cookieRaw}`
        : null;

      const requestBody = {
        role,
        ...(sessionId ? { session_id: sessionId } : {}),
        ...(Object.prototype.hasOwnProperty.call(turn, "tenant_id") ||
        Object.prototype.hasOwnProperty.call(scenario, "tenant_id")
          ? { tenant_id: tenant }
          : { tenant_id: "$TENANT_ID" }),
        message: buildMessage(turn),
        ...(turn.review_action ? { review_action: turn.review_action } : {}),
      };

      if (requestBody.tenant_id === "$TENANT_ID") {
        requestBody.tenant_id = tenantId;
      }

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
          failed_check: checks.find((check) => !check.pass) ?? null,
          status: response.status,
          snippet: toSnippet(response),
          debug: response.headers,
        };
      }

      if (!turnPass) scenarioPass = false;
    }

    results.push({
      name: scenario.name,
      source_file: scenario.__source_file ?? null,
      source_line: scenario.__line ?? null,
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
    `- Extended: ${extendedMode ? "yes" : "no"}`,
    `- Case Files: ${files.length}`,
    `- Cases: ${results.length}`,
    `- Passed: ${passed}`,
    `- Failed: ${failed}`,
    "",
    "| Scenario | Result | First Failure |",
    "| --- | --- | --- |",
    ...results.map((row) =>
      `| ${row.name} | ${row.pass ? "PASS" : "FAIL"} | ${
        row.first_fail
          ? `turn ${row.first_fail.turn}: ${row.first_fail.failed_check?.name ?? "unknown"}`
          : "-"
      } |`
    ),
  ];

  await writeFile(outputPath, `${lines.join("\n")}\n`, "utf8");

  console.log(`QUALITY ${failed === 0 ? "PASS" : "FAIL"}: ${passed}/${results.length}`);
  console.log(`Output: ${outputPath}`);
  if (failed > 0) {
    console.log("Failed scenarios:");
    for (const row of results.filter((item) => !item.pass)) {
      console.log(
        `- ${row.name} | src=${path.basename(row.source_file ?? "unknown")}:${
          row.source_line ?? "?"
        } | turn=${row.first_fail?.turn ?? "?"} | assertion=${
          row.first_fail?.failed_check?.name ?? "unknown"
        } | details=${JSON.stringify(row.first_fail?.failed_check?.details ?? null)} | snippet=${JSON.stringify(
          row.first_fail?.snippet ?? ""
        )} | debug=${JSON.stringify(row.first_fail?.debug ?? null)}`
      );
    }
  }

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
