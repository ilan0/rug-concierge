#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const baseUrl = readArgValue("--base-url") ?? "http://127.0.0.1:3100";
const tenantId = (process.env.TENANT_ID ?? "").trim();
const casesPath = path.resolve(
  process.cwd(),
  readArgValue("--cases") ?? "scripts/testing/quality/chat-check.ndjson"
);

if (!tenantId) {
  console.error("Missing TENANT_ID");
  process.exit(1);
}

function readArgValue(flag) {
  const index = args.indexOf(flag);
  if (index === -1) return null;
  return args[index + 1] ?? null;
}

function isPlainTextOnly(value) {
  if (typeof value !== "string") return true;
  if (value.includes("**")) return false;
  if (/^\s*[-*]\s+/m.test(value)) return false;
  return true;
}

async function loadCases() {
  const raw = await readFile(casesPath, "utf8");
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map((line) => JSON.parse(line));
}

async function postChat(body) {
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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

function evaluate(response, expect = {}) {
  const checks = [];

  if (typeof expect.status === "number") {
    checks.push({
      name: "status",
      pass: response.status === expect.status,
      detail: { expected: expect.status, actual: response.status },
    });
  }

  if (typeof expect.mode === "string") {
    const actualMode = response.json?.response?.mode;
    checks.push({
      name: "mode",
      pass: actualMode === expect.mode,
      detail: { expected: expect.mode, actual: actualMode ?? null },
    });
  }

  if (expect.plain_text_only === true) {
    const assistantMessage = response.json?.response?.assistant_message;
    const recommendations = Array.isArray(response.json?.response?.recommendations)
      ? response.json.response.recommendations
      : [];
    const recommendationReasonsOk = recommendations.every((row) =>
      Array.isArray(row?.match_reasons) &&
      row.match_reasons.every((reason) => isPlainTextOnly(reason))
    );

    checks.push({
      name: "plain_text",
      pass: isPlainTextOnly(assistantMessage) && recommendationReasonsOk,
      detail: {
        assistant_message_plain: isPlainTextOnly(assistantMessage),
        recommendation_reasons_plain: recommendationReasonsOk,
      },
    });
  }

  return checks;
}

function buildMarkdown(outputRows) {
  const lines = [];
  lines.push("# Quality QA Report");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Base URL: ${baseUrl}`);
  lines.push(`Tenant ID: ${tenantId}`);
  lines.push(`Cases: ${casesPath}`);
  lines.push("");
  lines.push("| Scenario | Turn | Check | Status | Details |");
  lines.push("| --- | --- | --- | --- | --- |");

  for (const row of outputRows) {
    lines.push(
      `| ${row.scenario} | ${row.turn} | ${row.check} | ${row.pass ? "PASS" : "FAIL"} | ${JSON.stringify(row.detail)} |`
    );
  }

  lines.push("");
  return lines.join("\n");
}

async function main() {
  const scenarios = await loadCases();
  const outputRows = [];

  for (const scenario of scenarios) {
    let sessionId = crypto.randomUUID();
    const turns = Array.isArray(scenario.turns) ? scenario.turns : [];

    for (let i = 0; i < turns.length; i += 1) {
      const turn = turns[i];
      const response = await postChat({
        message: turn.message,
        tenant_id: tenantId,
        session_id: sessionId,
      });

      if (typeof response.json?.session_id === "string") {
        sessionId = response.json.session_id;
      }

      const checks = evaluate(response, turn.expect);
      for (const check of checks) {
        outputRows.push({
          scenario: scenario.name ?? "unnamed",
          turn: i + 1,
          check: check.name,
          pass: check.pass,
          detail: check.detail,
        });
      }
    }
  }

  const markdown = buildMarkdown(outputRows);
  const outputPath = path.resolve(process.cwd(), "scripts/testing/quality/latest-quality.md");
  await writeFile(outputPath, markdown, "utf8");

  const hasFailure = outputRows.some((row) => !row.pass);
  process.exit(hasFailure ? 1 : 0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
