#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const docsDir = path.resolve(repoRoot, "docs");
const reportPath = path.resolve(repoRoot, "tmp/docs/drift-report.json");

const allowedDocs = new Set([
  "docs/master.md",
  "docs/prompts/system.md",
  "docs/prompts/general-chat.md",
  "docs/prompts/recommendation.md",
  "docs/prompts/recommendation-structured-output.md",
]);

const forbiddenTokens = [
  "contextual_blurb",
  "/api/ui-access",
  "trade_client",
  "needs_retake",
];

const requiredSections = [
  "# Rug Concierge Master Reference",
  "## Intake And Durable Enrichment",
  "## Deterministic Title Construction",
  "## Core APIs",
  "## Runtime Prompt Files",
];

const checks = [];

function addCheck(name, passed, details = "") {
  checks.push({ name, passed, details });
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readFileSafe(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function walkMarkdownFiles(dirPath) {
  const out = [];
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const absolute = path.resolve(dirPath, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkMarkdownFiles(absolute));
      continue;
    }
    if (entry.isFile() && absolute.endsWith(".md")) {
      out.push(absolute);
    }
  }
  return out;
}

const docFiles = fs.existsSync(docsDir) ? walkMarkdownFiles(docsDir) : [];
const docRelPaths = docFiles.map((file) => path.relative(repoRoot, file).replaceAll(path.sep, "/"));

addCheck("docs directory exists", fs.existsSync(docsDir), fs.existsSync(docsDir) ? "ok" : "missing docs/");

for (const relPath of allowedDocs) {
  const absolute = path.resolve(repoRoot, relPath);
  addCheck(`allowed doc exists: ${relPath}`, fs.existsSync(absolute), fs.existsSync(absolute) ? "ok" : "missing");
}

const unexpectedDocs = docRelPaths.filter((relPath) => !allowedDocs.has(relPath));
addCheck(
  "no unexpected markdown docs remain",
  unexpectedDocs.length === 0,
  unexpectedDocs.length === 0 ? "ok" : unexpectedDocs.join(", ")
);

const masterDoc = readFileSafe(path.resolve(repoRoot, "docs/master.md")) ?? "";
for (const section of requiredSections) {
  addCheck(
    `master doc contains section: ${section}`,
    masterDoc.includes(section),
    masterDoc.includes(section) ? "ok" : "missing"
  );
}

const allDocsText = docFiles.map((file) => readFileSafe(file) ?? "").join("\n").toLowerCase();
for (const token of forbiddenTokens) {
  addCheck(
    `forbidden token absent: ${token}`,
    !allDocsText.includes(token),
    allDocsText.includes(token) ? "token present in docs" : "ok"
  );
}

const pathRegex = /`((docs|apps|packages|scripts)\/[^`]+)`/g;
const referencedPaths = new Set();
for (const docFile of docFiles) {
  const text = readFileSafe(docFile) ?? "";
  for (const match of text.matchAll(pathRegex)) {
    referencedPaths.add(match[1]);
  }
}

for (const relPath of referencedPaths) {
  const absolute = path.resolve(repoRoot, relPath);
  addCheck(
    `referenced path exists: ${relPath}`,
    fs.existsSync(absolute),
    fs.existsSync(absolute) ? "ok" : "missing referenced path"
  );
}

const passed = checks.every((check) => check.passed);
ensureDir(path.dirname(reportPath));
fs.writeFileSync(
  reportPath,
  JSON.stringify(
    {
      generated_at: new Date().toISOString(),
      passed,
      checks,
    },
    null,
    2
  )
);

if (!passed) {
  for (const check of checks.filter((row) => !row.passed)) {
    console.error(`[docs-drift] FAIL: ${check.name} (${check.details})`);
  }
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      passed,
      checks: checks.length,
      report: path.relative(repoRoot, reportPath),
    },
    null,
    2
  )
);
