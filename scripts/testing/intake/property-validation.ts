#!/usr/bin/env -S npx tsx

import path from "node:path";
import fc from "fast-check";
import {
  parseDimensionField,
  validateDimensionTuple,
  validateIntakeLabel,
} from "../../../apps/web/lib/intake/validation";
import {
  nowIso,
  pushCheck,
  renderMarkdownReport,
  requireTenantId,
  resolveArtifactRoot,
  summarizeChecks,
  writeJson,
  writeText,
  readArgValue,
} from "./common.mjs";

const args = process.argv.slice(2);
const baseUrl = readArgValue(args, "--base-url") ?? "local-function";
const runId = readArgValue(args, "--run-id") ?? `property-validation-${Date.now()}`;
const tenantId = requireTenantId();
const artifactRoot = resolveArtifactRoot(runId);
const outputRoot = path.resolve(artifactRoot, "property-validation");
const reportPath = path.resolve(outputRoot, "report.md");
const jsonPath = path.resolve(outputRoot, "report.json");

async function run() {
  const checks: Array<{ name: string; severity: string; pass: boolean; details: unknown }> = [];
  const propertyLog: Array<{ name: string; pass: boolean; error?: string }> = [];

  const runProperty = (name: string, severity: "P0" | "P1" | "P2" | "P3", fn: () => void) => {
    try {
      fn();
      pushCheck(checks, {
        name,
        severity,
        pass: true,
        details: null,
      });
      propertyLog.push({ name, pass: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      pushCheck(checks, {
        name,
        severity,
        pass: false,
        details: { error: message },
      });
      propertyLog.push({ name, pass: false, error: message });
    }
  };

  runProperty("parseDimensionField accepts feet 0..99", "P2", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 99 }), (value) => {
        const parsed = parseDimensionField(String(value), "width_ft");
        return parsed === value;
      }),
      { numRuns: 300 }
    );
  });

  runProperty("parseDimensionField accepts inches 0..11", "P2", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 11 }), (value) => {
        const parsed = parseDimensionField(String(value), "length_in");
        return parsed === value;
      }),
      { numRuns: 300 }
    );
  });

  runProperty("parseDimensionField rejects out-of-range values", "P2", () => {
    fc.assert(
      fc.property(fc.integer({ min: 12, max: 500 }), (value) => {
        const inch = parseDimensionField(String(value), "width_in");
        const feet = parseDimensionField(String(value), "width_ft");
        return inch === null && (value > 99 ? feet === null : true);
      }),
      { numRuns: 300 }
    );
  });

  runProperty("parseDimensionField rejects non-digit strings", "P2", () => {
    fc.assert(
      fc.property(
        fc.string().filter((value) => !/^\d+$/.test(value.trim())),
        (value) => {
          const parsed = parseDimensionField(value, "length_ft");
          return parsed === null;
        }
      ),
      { numRuns: 300 }
    );
  });

  runProperty("validateDimensionTuple totals are consistent", "P1", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 40 }),
        fc.integer({ min: 0, max: 11 }),
        fc.integer({ min: 0, max: 40 }),
        fc.integer({ min: 0, max: 11 }),
        (wFt, wIn, lFt, lIn) => {
          const result = validateDimensionTuple({
            widthFt: wFt,
            widthIn: wIn,
            lengthFt: lFt,
            lengthIn: lIn,
          });

          const widthTotal = wFt * 12 + wIn;
          const lengthTotal = lFt * 12 + lIn;
          if (widthTotal <= 0 || lengthTotal <= 0) {
            return result.ok === false;
          }

          if (!result.ok) return false;
          return (
            result.value.widthTotalIn === widthTotal &&
            result.value.lengthTotalIn === lengthTotal
          );
        }
      ),
      { numRuns: 400 }
    );
  });

  runProperty("validateIntakeLabel enforces required and max length", "P2", () => {
    fc.assert(
      fc.property(fc.string(), (value) => {
        const result = validateIntakeLabel(value);
        const trimmed = value.trim();

        if (trimmed.length === 0) {
          return !result.ok;
        }
        if (trimmed.length > 120) {
          return !result.ok;
        }
        return result.ok && result.value === trimmed;
      }),
      { numRuns: 300 }
    );
  });

  const summary = summarizeChecks(checks);
  const report = renderMarkdownReport({
    title: "Intake Property Validation Suite",
    generatedAt: nowIso(),
    runId,
    baseUrl,
    tenantId,
    checks,
  });

  await writeText(reportPath, report);
  await writeJson(jsonPath, {
    generated_at: nowIso(),
    run_id: runId,
    base_url: baseUrl,
    tenant_id: tenantId,
    summary,
    checks,
    properties: propertyLog,
  });

  console.log(`INTAKE PROPERTY ${summary.passedAll ? "PASS" : "FAIL"}: ${summary.passed}/${checks.length}`);
  console.log(`Output: ${reportPath}`);

  if (!summary.passedAll) {
    process.exit(1);
  }
}

run().catch(async (error) => {
  const fallback = {
    generated_at: nowIso(),
    run_id: runId,
    base_url: baseUrl,
    tenant_id: tenantId,
    error: error instanceof Error ? error.message : String(error),
  };
  await writeJson(jsonPath, fallback);
  await writeText(
    reportPath,
    `# Intake Property Validation Suite\n\n- Generated: ${nowIso()}\n- Error: ${fallback.error}\n`
  );
  console.error(error);
  process.exit(1);
});
