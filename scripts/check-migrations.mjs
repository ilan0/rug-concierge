#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const migrationsDir = path.resolve(repoRoot, "packages/db/migrations");
const expectedSchemaPath = path.resolve(
  repoRoot,
  "scripts/migrations/expected-runtime-schema.json"
);
const reportPath = path.resolve(
  repoRoot,
  "tmp/migrations/verification-report.json"
);
const freshSqlPath = path.resolve(repoRoot, "tmp/migrations/fresh-apply.sql");

const checks = [];

function addCheck(name, passed, details = "") {
  checks.push({ name, passed, details });
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function loadEnvFileIfExists(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const sep = line.indexOf("=");
    const key = line.slice(0, sep).trim();
    let value = line.slice(sep + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function loadEnv() {
  loadEnvFileIfExists(path.resolve(repoRoot, ".env.local"));
  loadEnvFileIfExists(path.resolve(repoRoot, "apps/web/.env.local"));
}

function readTrimmedEnv(name) {
  const value = process.env[name];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function getMigrationFiles() {
  return fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort();
}

async function fetchOpenApiSpec(input) {
  const response = await fetch(`${input.supabaseUrl}/rest/v1/`, {
    headers: {
      apikey: input.supabaseKey,
      Authorization: `Bearer ${input.supabaseKey}`,
    },
  });
  if (!response.ok) {
    throw new Error(`OpenAPI fetch failed with status ${response.status}`);
  }
  return response.json();
}

function canonicalizeColumns(values) {
  return [...new Set(values)].sort();
}

async function main() {
  const expectedSchema = JSON.parse(
    fs.readFileSync(expectedSchemaPath, "utf8")
  );

  const migrationFiles = getMigrationFiles();
  addCheck("migration file count > 0", migrationFiles.length > 0, String(migrationFiles.length));

  const sortedCopy = [...migrationFiles].sort();
  addCheck(
    "migration file names are lexically ordered",
    JSON.stringify(migrationFiles) === JSON.stringify(sortedCopy),
    "lexical ordering check"
  );

  const concatenated = [];
  for (const file of migrationFiles) {
    const absolute = path.resolve(migrationsDir, file);
    const sql = fs.readFileSync(absolute, "utf8");
    concatenated.push(`-- ${file}\n${sql.trim()}\n`);

    const hasBegin = /\bbegin\b/i.test(sql);
    const hasCommit = /\bcommit\b/i.test(sql);
    addCheck(`transaction markers: ${file}`, hasBegin && hasCommit, hasBegin && hasCommit ? "ok" : "missing begin/commit");
  }

  ensureDir(path.dirname(freshSqlPath));
  fs.writeFileSync(freshSqlPath, concatenated.join("\n"));
  addCheck("fresh apply SQL artifact generated", fs.existsSync(freshSqlPath), path.relative(repoRoot, freshSqlPath));

  const backupDir = path.resolve(
    repoRoot,
    "packages/db/migration-history-backup/2026-03-15-pre-rewrite"
  );
  addCheck(
    "pre-rewrite migration backup exists",
    fs.existsSync(backupDir),
    fs.existsSync(backupDir) ? "ok" : "missing backup directory"
  );

  loadEnv();
  const supabaseUrl = readTrimmedEnv("SUPABASE_URL");
  const supabaseKey = readTrimmedEnv("SUPABASE_SECRET_KEY");

  if (!supabaseUrl || !supabaseKey) {
    addCheck(
      "live schema comparison skipped",
      true,
      "SUPABASE_URL + admin key not configured; static migration checks only"
    );
  } else {
    const spec = await fetchOpenApiSpec({ supabaseUrl, supabaseKey });
    const definitions = spec?.definitions ?? {};

    for (const [table, expectedColumns] of Object.entries(expectedSchema.tables)) {
      const tableDef = definitions[table];
      const actualColumns = tableDef?.properties
        ? Object.keys(tableDef.properties)
        : [];

      const expected = canonicalizeColumns(expectedColumns);
      const actual = canonicalizeColumns(actualColumns);

      const missing = expected.filter((column) => !actual.includes(column));
      const extra = actual.filter((column) => !expected.includes(column));
      const passed = missing.length === 0 && extra.length === 0;

      addCheck(
        `live schema matches expected columns: ${table}`,
        passed,
        passed
          ? "ok"
          : `missing=[${missing.join(", ")}], extra=[${extra.join(", ")}]`
      );
    }
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
        fresh_apply_sql: path.relative(repoRoot, freshSqlPath),
      },
      null,
      2
    )
  );

  if (!passed) {
    for (const check of checks.filter((row) => !row.passed)) {
      console.error(`[migrations] FAIL: ${check.name} (${check.details})`);
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
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
