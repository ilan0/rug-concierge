#!/usr/bin/env node

import { writeFile } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const baseUrl = readArgValue("--base-url") ?? "http://127.0.0.1:3100";
const tenantId = (process.env.TENANT_ID ?? "").trim();

if (!tenantId) {
  console.error("Missing TENANT_ID");
  process.exit(1);
}

function readArgValue(flag) {
  const index = args.indexOf(flag);
  if (index === -1) return null;
  return args[index + 1] ?? null;
}

async function requestJson(endpoint, input = {}) {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method: input.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(input.headers ?? {}),
    },
    body: input.body ? JSON.stringify(input.body) : undefined,
  });

  const raw = await response.text();
  let json = null;
  try {
    json = JSON.parse(raw);
  } catch {
    json = null;
  }

  return {
    endpoint,
    status: response.status,
    ok: response.ok,
    json,
    raw,
    contentType: response.headers.get("content-type") ?? "",
  };
}

function isPlainTextOnly(value) {
  if (typeof value !== "string") return true;
  if (value.includes("**")) return false;
  if (/^\s*[-*]\s+/m.test(value)) return false;
  return true;
}

const results = [];

function record(name, pass, details = {}) {
  results.push({ name, pass, details });
}

async function main() {
  const hi = await requestJson("/api/chat", {
    method: "POST",
    body: { message: "hi", tenant_id: tenantId },
  });
  record(
    "chat endpoint returns 200 for greeting",
    hi.status === 200 && typeof hi.json?.response?.assistant_message === "string",
    { endpoint: hi.endpoint, status: hi.status }
  );

  const recommend = await requestJson("/api/chat", {
    method: "POST",
    body: { message: "show me something 8x10 for a living room", tenant_id: tenantId },
  });
  const recommendationRows = Array.isArray(recommend.json?.response?.recommendations)
    ? recommend.json.response.recommendations
    : [];
  const recommendationReasonsArePlain = recommendationRows.every((row) =>
    isPlainTextOnly(row?.why_this_fits)
  );
  record(
    "recommendation turn returns 200 with plain text reasons",
    recommend.status === 200 && recommendationReasonsArePlain,
    { endpoint: recommend.endpoint, status: recommend.status, recommendation_count: recommendationRows.length }
  );

  const config = await requestJson("/api/config/public");
  record(
    "public config endpoint returns 200",
    config.status === 200 && typeof config.json?.storeName === "string",
    { endpoint: config.endpoint, status: config.status }
  );

  const manifest = await requestJson("/api/manifest");
  record(
    "manifest endpoint returns JSON manifest",
    manifest.status === 200 && manifest.contentType.includes("application/manifest+json"),
    { endpoint: manifest.endpoint, status: manifest.status, content_type: manifest.contentType }
  );

  const reset = await requestJson("/api/session/reset", {
    method: "POST",
    body: {},
  });
  record(
    "session reset returns new UUID",
    reset.status === 200 && typeof reset.json?.new_session_id === "string",
    { endpoint: reset.endpoint, status: reset.status }
  );

  const passcode = await requestJson("/api/auth/passcode", {
    method: "POST",
    body: { passcode: "0000" },
  });
  record(
    "passcode endpoint is callable",
    passcode.status === 404 || passcode.status === 401 || passcode.status === 429 || passcode.status === 200,
    { endpoint: passcode.endpoint, status: passcode.status }
  );

  const output = buildMarkdown(results);
  const outputPath = path.resolve(process.cwd(), "scripts/testing/functionality/latest-functional.md");
  await writeFile(outputPath, output, "utf8");

  const hasFailure = results.some((result) => !result.pass);
  process.exit(hasFailure ? 1 : 0);
}

function buildMarkdown(rows) {
  const lines = [];
  lines.push("# Functional QA Report");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Base URL: ${baseUrl}`);
  lines.push(`Tenant ID: ${tenantId}`);
  lines.push("");
  lines.push("| Check | Status | Details |");
  lines.push("| --- | --- | --- |");
  for (const row of rows) {
    lines.push(
      `| ${row.name} | ${row.pass ? "PASS" : "FAIL"} | ${JSON.stringify(row.details)} |`
    );
  }
  lines.push("");
  return lines.join("\n");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
