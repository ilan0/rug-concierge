#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const docsDir = path.resolve(repoRoot, "docs");
const reportPath = path.resolve(repoRoot, "tmp/docs/drift-report.json");

const canonicalDocs = [
  "docs/master-context.md",
  "docs/data/schema.md",
  "docs/deployment/runbook.md",
  "docs/deployment/env-vars.md",
  "docs/testing/operations.md",
  "docs/design/architecture-flow.md",
];

const pointerDocs = [
  "docs/design/chat-orchestration.md",
  "docs/design/concierge-flow.md",
  "docs/design/role-capability-matrix.md",
  "docs/testing/README.md",
];

const forbiddenTokens = [
  "contextual_blurb",
  "/api/ui-access",
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

for (const relPath of canonicalDocs) {
  const absolute = path.resolve(repoRoot, relPath);
  addCheck(
    `canonical doc exists: ${relPath}`,
    fs.existsSync(absolute),
    fs.existsSync(absolute) ? "ok" : "missing"
  );
}

for (const relPath of pointerDocs) {
  const absolute = path.resolve(repoRoot, relPath);
  const contents = readFileSafe(absolute);
  const hasPointerLanguage =
    typeof contents === "string" &&
    (contents.toLowerCase().includes("pointer") ||
      contents.toLowerCase().includes("consolidated into"));
  addCheck(
    `pointer doc is reduced: ${relPath}`,
    hasPointerLanguage,
    hasPointerLanguage ? "ok" : "missing pointer marker"
  );
}

const docFiles = [];
for (const firstLevel of fs.readdirSync(docsDir)) {
  const firstLevelPath = path.resolve(docsDir, firstLevel);
  const stats = fs.statSync(firstLevelPath);
  if (stats.isFile() && firstLevelPath.endsWith(".md")) {
    docFiles.push(firstLevelPath);
    continue;
  }
  if (!stats.isDirectory()) continue;
  for (const nested of fs.readdirSync(firstLevelPath)) {
    const nestedPath = path.resolve(firstLevelPath, nested);
    if (fs.statSync(nestedPath).isFile() && nestedPath.endsWith(".md")) {
      docFiles.push(nestedPath);
    }
  }
}

const allDocsText = docFiles
  .map((file) => readFileSafe(file) ?? "")
  .join("\n")
  .toLowerCase();

for (const token of forbiddenTokens) {
  addCheck(
    `forbidden token absent: ${token}`,
    !allDocsText.includes(token),
    allDocsText.includes(token) ? "token present in docs" : "ok"
  );
}

const masterContext = readFileSafe(path.resolve(repoRoot, "docs/master-context.md")) ?? "";
addCheck(
  "master context has source-of-truth table",
  masterContext.includes("## Source Of Truth Map"),
  masterContext.includes("## Source Of Truth Map")
    ? "ok"
    : "missing source-of-truth map section"
);

const pathRegex = /`((docs|apps|packages|scripts)\/[^`]+)`/g;
const referencedPaths = new Set();
for (const docFile of docFiles) {
  const text = readFileSafe(docFile) ?? "";
  for (const match of text.matchAll(pathRegex)) {
    referencedPaths.add(match[1]);
  }
}

for (const relPath of [...referencedPaths]) {
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

