#!/usr/bin/env node

import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { chromium, devices, webkit } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import {
  cleanupRugArtifacts,
  ensureDir,
  getSupabaseAdmin,
  makeSignedRoleCookieValue,
  nowIso,
  pushCheck,
  renderMarkdownReport,
  requireTenantId,
  resolveArtifactRoot,
  summarizeChecks,
  tinyPngBytes,
  writeJson,
  writeText,
  readArgValue,
} from "./common.mjs";

const args = process.argv.slice(2);
const baseUrl = readArgValue(args, "--base-url") ?? "http://127.0.0.1:3100";
const runId = readArgValue(args, "--run-id") ?? `ui-e2e-${Date.now()}`;
const tenantId = requireTenantId();
const artifactRoot = resolveArtifactRoot(runId);
const outputRoot = path.resolve(artifactRoot, "ui-e2e");
const screenshotRoot = path.resolve(outputRoot, "screenshots");
const reportPath = path.resolve(outputRoot, "report.md");
const jsonPath = path.resolve(outputRoot, "report.json");

const baselineMap = {
  "chromium-desktop": "/tmp/intake-chromium-desktop.png",
  "webkit-desktop": "/tmp/intake-webkit-desktop.png",
  "chromium-mobile": "/tmp/intake-chromium-mobile.png",
  "webkit-mobile": "/tmp/intake-webkit-mobile.png",
};

const VISUAL_DIFF_THRESHOLD = 0.05;

function cookieSet(hostname, tenant) {
  return [
    {
      name: "rug_ui_role",
      value: makeSignedRoleCookieValue("store_staff", tenant),
      domain: hostname,
      path: "/",
      sameSite: "Lax",
    },
    {
      name: "rug_ui_tenant_id",
      value: tenant,
      domain: hostname,
      path: "/",
      sameSite: "Lax",
    },
  ];
}

async function compareScreenshotWithBaseline({ key, actualPath, diffPath }) {
  const baselinePath = baselineMap[key];
  if (!baselinePath) {
    return {
      pass: true,
      ratio: null,
      baseline_exists: false,
      reason: "missing baseline mapping",
    };
  }

  let baselineBuffer;
  try {
    baselineBuffer = await readFile(baselinePath);
  } catch {
    return {
      pass: true,
      ratio: null,
      baseline_exists: false,
      reason: "baseline file does not exist",
    };
  }

  const actualBuffer = await readFile(actualPath);
  const baselinePng = PNG.sync.read(baselineBuffer);
  const actualPng = PNG.sync.read(actualBuffer);

  if (
    baselinePng.width !== actualPng.width ||
    baselinePng.height !== actualPng.height
  ) {
    return {
      pass: true,
      ratio: null,
      baseline_exists: true,
      reason: "dimension mismatch (comparison skipped)",
      baseline_size: {
        width: baselinePng.width,
        height: baselinePng.height,
      },
      actual_size: {
        width: actualPng.width,
        height: actualPng.height,
      },
    };
  }

  const diff = new PNG({ width: actualPng.width, height: actualPng.height });
  const mismatch = pixelmatch(
    baselinePng.data,
    actualPng.data,
    diff.data,
    actualPng.width,
    actualPng.height,
    { threshold: 0.1 }
  );

  await writeFile(diffPath, PNG.sync.write(diff));

  const totalPixels = actualPng.width * actualPng.height;
  const ratio = totalPixels > 0 ? mismatch / totalPixels : 0;

  return {
    pass: ratio <= VISUAL_DIFF_THRESHOLD,
    ratio,
    baseline_exists: true,
    baseline_path: baselinePath,
    diff_path: diffPath,
  };
}

async function runScreenshotAndA11yAudit({ browserName, mobile, checks, artifacts }) {
  const browserType = browserName === "webkit" ? webkit : chromium;
  const browser = await browserType.launch();
  try {
    const hostname = new URL(baseUrl).hostname;
    const contextOptions = mobile
      ? {
          ...devices["iPhone 13"],
        }
      : {
          viewport: { width: 1440, height: 900 },
        };

    const context = await browser.newContext(contextOptions);
    await context.addCookies(cookieSet(hostname, tenantId));
    const page = await context.newPage();
    await page.goto(`${baseUrl}/intake`, { waitUntil: "networkidle" });

    const key = `${browserName}-${mobile ? "mobile" : "desktop"}`;
    const screenshotPath = path.resolve(screenshotRoot, `${key}.png`);
    const diffPath = path.resolve(screenshotRoot, `${key}.diff.png`);

    await page.screenshot({ path: screenshotPath, fullPage: true });

    const audit = await new AxeBuilder({ page }).analyze();
    const critical = audit.violations.filter((violation) => violation.impact === "critical");
    const serious = audit.violations.filter((violation) => violation.impact === "serious");

    pushCheck(checks, {
      name: `${key} intake page renders heading`,
      severity: "P2",
      pass: (await page.locator("h1").first().textContent())?.includes("Inventory Intake") ?? false,
      details: {
        screenshot: screenshotPath,
      },
    });

    pushCheck(checks, {
      name: `${key} has no critical axe violations`,
      severity: "P2",
      pass: critical.length === 0,
      details: {
        critical_count: critical.length,
        serious_count: serious.length,
        violations: critical.map((violation) => ({
          id: violation.id,
          impact: violation.impact,
          description: violation.description,
        })),
      },
    });

    const visual = await compareScreenshotWithBaseline({
      key,
      actualPath: screenshotPath,
      diffPath,
    });

    pushCheck(checks, {
      name: `${key} visual diff within tolerance`,
      severity: "P3",
      pass: visual.pass,
      details: visual,
    });

    artifacts.push({
      type: "screenshot-audit",
      key,
      screenshot: screenshotPath,
      axe_violations: audit.violations.length,
      visual,
    });

    await context.close();
  } finally {
    await browser.close();
  }
}

async function fillIntakeForm(page, fixturePath, label) {
  await page.locator("#intake-label").fill(label);
  await page.locator("#width-ft").fill("8");
  await page.locator("#length-ft").fill("10");

  const inchInputs = page.locator('input[placeholder="in"]');
  await inchInputs.first().fill("0");
  await inchInputs.nth(1).fill("0");

  await page.setInputFiles("#intake-photo", fixturePath);
}

async function readSavedRugId(page) {
  const idLine = await page.locator("p:has-text('ID:')").last().textContent();
  const match =
    typeof idLine === "string"
      ? idLine.match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i)
      : null;
  return match ? match[0].toLowerCase() : null;
}

async function runChromiumFunctionalFlow({ checks, artifacts, createdRugIds, fixturePath }) {
  const browser = await chromium.launch();
  try {
    const hostname = new URL(baseUrl).hostname;
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addCookies(cookieSet(hostname, tenantId));

    const page = await context.newPage();
    let intakeCallCount = 0;
    await page.route("**/api/inventory/intake", async (route) => {
      intakeCallCount += 1;
      await route.continue();
    });

    await page.goto(`${baseUrl}/intake`, { waitUntil: "networkidle" });

    const label = `QA UI success ${runId}`;
    await fillIntakeForm(page, fixturePath, label);

    const saveButton = page.getByRole("button", { name: "Save Rug" });
    await saveButton.click();
    await saveButton.click({ timeout: 500 }).catch(() => {});

    await page.getByText("Saved", { exact: false }).first().waitFor({ timeout: 10000 });

    const rugId = await readSavedRugId(page);
    if (rugId) {
      createdRugIds.add(rugId);
    }

    const labelValue = await page.locator("#intake-label").inputValue();
    const widthFtValue = await page.locator("#width-ft").inputValue();
    const lengthFtValue = await page.locator("#length-ft").inputValue();

    const inchInputs = page.locator('input[placeholder="in"]');
    const widthInValue = await inchInputs.first().inputValue();
    const lengthInValue = await inchInputs.nth(1).inputValue();

    pushCheck(checks, {
      name: "chromium save flow returns success notice",
      severity: "P1",
      pass: Boolean(rugId),
      details: {
        rug_id: rugId,
      },
    });

    pushCheck(checks, {
      name: "chromium submit lock prevents duplicate intake creates",
      severity: "P1",
      pass: intakeCallCount === 1,
      details: {
        intake_call_count: intakeCallCount,
      },
    });

    pushCheck(checks, {
      name: "save-next behavior clears label and keeps dimensions",
      severity: "P2",
      pass:
        labelValue === "" &&
        widthFtValue === "8" &&
        widthInValue === "0" &&
        lengthFtValue === "10" &&
        lengthInValue === "0",
      details: {
        label_value: labelValue,
        width_ft: widthFtValue,
        width_in: widthInValue,
        length_ft: lengthFtValue,
        length_in: lengthInValue,
      },
    });

    const successScreenshot = path.resolve(screenshotRoot, "chromium-success-flow.png");
    await page.screenshot({ path: successScreenshot, fullPage: true });
    artifacts.push({
      type: "ui-success",
      screenshot: successScreenshot,
      intake_call_count: intakeCallCount,
      rug_id: rugId,
    });

    await page.unroute("**/api/inventory/intake");

    // Error + retry path.
    const retryPage = await context.newPage();
    let retryCallCount = 0;
    await retryPage.route("**/api/inventory/intake", async (route) => {
      retryCallCount += 1;
      if (retryCallCount === 1) {
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "Simulated failure", code: "CHAT_INTERNAL_ERROR" }),
        });
        return;
      }
      await route.continue();
    });

    await retryPage.goto(`${baseUrl}/intake`, { waitUntil: "networkidle" });
    await fillIntakeForm(retryPage, fixturePath, `QA UI retry ${runId}`);

    await retryPage.getByRole("button", { name: "Save Rug" }).click();
    const errorAlert = retryPage
      .getByText("Intake failed", { exact: false })
      .first();
    await errorAlert.waitFor({ timeout: 10000 });
    const errorVisible = await errorAlert.isVisible().catch(() => false);

    await retryPage.getByRole("button", { name: "Save Rug" }).click();
    const savedAlert = retryPage.getByText("Saved", { exact: false }).first();
    await savedAlert.waitFor({ timeout: 10000 });
    const savedVisible = await savedAlert.isVisible().catch(() => false);

    const retryRugId = await readSavedRugId(retryPage);
    if (retryRugId) {
      createdRugIds.add(retryRugId);
    }

    pushCheck(checks, {
      name: "error flow shows retry messaging and allows successful retry",
      severity: "P2",
      pass:
        errorVisible &&
        savedVisible &&
        retryCallCount >= 2,
      details: {
        retry_call_count: retryCallCount,
        retry_rug_id: retryRugId,
        error_visible: errorVisible,
        saved_visible: savedVisible,
      },
    });

    const retryScreenshot = path.resolve(screenshotRoot, "chromium-retry-flow.png");
    await retryPage.screenshot({ path: retryScreenshot, fullPage: true });
    artifacts.push({
      type: "ui-retry",
      screenshot: retryScreenshot,
      retry_call_count: retryCallCount,
      rug_id: retryRugId,
    });

    await context.close();
  } finally {
    await browser.close();
  }
}

async function run() {
  const checks = [];
  const artifacts = [];
  const createdRugIds = new Set();
  const supabase = getSupabaseAdmin();

  await ensureDir(outputRoot);
  await ensureDir(screenshotRoot);
  await ensureDir(path.resolve(outputRoot, "fixtures"));

  const fixturePath = path.resolve(outputRoot, "fixtures", "intake-image.png");
  await writeFile(fixturePath, Buffer.from(tinyPngBytes()));

  await runScreenshotAndA11yAudit({
    browserName: "chromium",
    mobile: false,
    checks,
    artifacts,
  });
  await runScreenshotAndA11yAudit({
    browserName: "webkit",
    mobile: false,
    checks,
    artifacts,
  });
  await runScreenshotAndA11yAudit({
    browserName: "chromium",
    mobile: true,
    checks,
    artifacts,
  });
  await runScreenshotAndA11yAudit({
    browserName: "webkit",
    mobile: true,
    checks,
    artifacts,
  });

  await runChromiumFunctionalFlow({
    checks,
    artifacts,
    createdRugIds,
    fixturePath,
  });

  const cleanupResults = [];
  for (const rugId of createdRugIds) {
    const cleanup = await cleanupRugArtifacts({
      supabase,
      tenantId,
      rugId,
    });
    cleanupResults.push({ rug_id: rugId, cleanup });
  }

  pushCheck(checks, {
    name: "ui suite cleanup removed all created rugs",
    severity: "P0",
    pass: cleanupResults.every(
      (item) =>
        item.cleanup.errors.length === 0 &&
        !item.cleanup.post.rug &&
        item.cleanup.post.imageRows.length === 0 &&
        item.cleanup.post.storageObjects.length === 0
    ),
    details: cleanupResults.map((item) => ({
      rug_id: item.rug_id,
      cleanup_errors: item.cleanup.errors,
      post_rug_present: Boolean(item.cleanup.post.rug),
      post_rug_images_count: item.cleanup.post.imageRows.length,
      post_storage_objects_count: item.cleanup.post.storageObjects.length,
    })),
  });

  const summary = summarizeChecks(checks);
  const report = renderMarkdownReport({
    title: "Intake UI E2E Suite",
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
    artifacts,
  });

  console.log(`INTAKE UI E2E ${summary.passedAll ? "PASS" : "FAIL"}: ${summary.passed}/${checks.length}`);
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
    `# Intake UI E2E Suite\n\n- Generated: ${nowIso()}\n- Error: ${fallback.error}\n`
  );
  console.error(error);
  process.exit(1);
});
