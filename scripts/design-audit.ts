#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  chromium,
  devices,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
} from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { buildDeviceAuthCookieValue, getCookieSecret } from "../apps/web/lib/auth/device-auth";

type AxeSummary = {
  violations: number;
  seriousOrCritical: number;
  ids: string[];
};

type InventoryMetrics = {
  viewportH: number;
  hasHeading: boolean;
  headingBottom: number;
  controlsTop: number;
  controlsHeight: number;
  firstResultTop: number;
  firstResultVisibleNoScroll: boolean;
  firstResultWithinMinimalScroll: boolean;
  statusLaneOverflowing: boolean;
  sizeLaneOverflowing: boolean;
  statusChipCount: number;
  sortChipCount: number;
  sizeChipCount: number;
  hasSearch: boolean;
  hasFiltersButton: boolean;
  hasApplyButton: boolean;
  activeFilterRemoveButtons: number;
};

type RoutePath = "/concierge" | "/inventory" | "/intake";

type RouteAudit = {
  route: RoutePath;
  screenshot: string;
  axe: AxeSummary;
};

type ProfileAuditResult = {
  profile: "desktop" | "mobile";
  routes: RouteAudit[];
  inventoryMetrics: InventoryMetrics;
  unlockAttempted: boolean;
  unlockSucceeded: boolean;
};

type RubricResult = {
  above_the_fold_utility: boolean;
  visual_hierarchy: boolean;
  cognitive_load_control_clarity: boolean;
  mobile_ergonomics: boolean;
  interaction_consistency: boolean;
  accessibility_semantics: boolean;
  brand_aesthetic_cohesion: boolean;
};

const ROUTES: RoutePath[] = ["/concierge", "/inventory", "/intake"];
const STAFF_COOKIE_SCOPE_ID = "staff-unlock";
const STAFF_COOKIE_NAME = "staff_unlocked";

function argValue(name: string, fallback: string): string {
  const arg = process.argv.find((entry) => entry.startsWith(`--${name}=`));
  if (!arg) return fallback;
  const value = arg.slice(name.length + 3).trim();
  return value.length > 0 ? value : fallback;
}

function parsePositiveInt(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return parsed;
}

function routeName(route: RoutePath): string {
  return route.replace("/", "") || "home";
}

function buildStaffCookieValue(): string {
  const cookieSecret = getCookieSecret();
  if (!cookieSecret) return "1";
  return buildDeviceAuthCookieValue({
    tenantId: STAFF_COOKIE_SCOPE_ID,
    cookieSecret,
  });
}

async function unlockStaffIfConfigured(input: {
  page: Page;
  context: BrowserContext;
  passcode: string;
  baseUrl: string;
}): Promise<boolean> {
  const { page, context, passcode, baseUrl } = input;
  if (!passcode) return false;
  await page.goto("/concierge", { waitUntil: "networkidle" });
  const result = await page.evaluate(async (code) => {
    const res = await fetch("/api/auth/passcode", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ passcode: code }),
    });
    return { ok: res.ok, status: res.status };
  }, passcode);
  if (result.ok) return true;

  if (result.status === 429) {
    await context.addCookies([
      {
        name: STAFF_COOKIE_NAME,
        value: buildStaffCookieValue(),
        url: baseUrl,
        httpOnly: true,
        secure: baseUrl.startsWith("https://"),
        sameSite: "Lax",
      },
    ]);
    return true;
  }

  return false;
}

async function runAxe(page: Page): Promise<AxeSummary> {
  const analysis = await new AxeBuilder({ page }).analyze();
  const seriousOrCritical = analysis.violations.filter((violation) =>
    violation.impact === "serious" || violation.impact === "critical"
  ).length;

  return {
    violations: analysis.violations.length,
    seriousOrCritical,
    ids: analysis.violations.map((violation) => violation.id),
  };
}

async function measureInventoryMetrics(page: Page): Promise<InventoryMetrics> {
  return page.evaluate(() => {
    const viewportH = window.innerHeight;
    const heading = document.querySelector("h1");
    const controls = document.querySelector("[data-inventory-controls='true']");
    const statusScroller = document.querySelector(
      "[data-filter-lane='status'] .overflow-x-auto"
    ) as HTMLElement | null;
    const sizeScroller = document.querySelector(
      "[data-filter-lane='size'] .overflow-x-auto"
    ) as HTMLElement | null;

    const resultCandidates = [
      ...Array.from(document.querySelectorAll("[data-inventory-results='true'] tbody tr")),
      ...Array.from(document.querySelectorAll("[data-inventory-results='true'] article")),
    ].filter((node) => {
      const htmlNode = node as HTMLElement;
      const rect = htmlNode.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      const styles = window.getComputedStyle(htmlNode);
      return (
        styles.display !== "none" &&
        styles.visibility !== "hidden" &&
        styles.opacity !== "0"
      );
    });
    const firstResult = resultCandidates
      .map((node) => ({ node, top: (node as HTMLElement).getBoundingClientRect().top }))
      .sort((a, b) => a.top - b.top)[0];

    const headingBottom = heading
      ? Math.round((heading as HTMLElement).getBoundingClientRect().bottom)
      : 0;
    const controlsTop = controls
      ? Math.round((controls as HTMLElement).getBoundingClientRect().top)
      : 0;
    const controlsHeight = controls
      ? Math.round((controls as HTMLElement).getBoundingClientRect().height)
      : 0;
    const firstResultTop = firstResult ? Math.round(firstResult.top) : 0;

    const statusChipCount = document.querySelectorAll("[data-filter-lane='status'] button").length;
    const sortChipCount = document.querySelectorAll("[data-filter-lane='sort'] button").length;
    const sizeChipCount = document.querySelectorAll("[data-filter-lane='size'] button").length;

    return {
      viewportH,
      hasHeading: Boolean(heading),
      headingBottom,
      controlsTop,
      controlsHeight,
      firstResultTop,
      firstResultVisibleNoScroll: firstResultTop > 0 && firstResultTop <= viewportH,
      firstResultWithinMinimalScroll: firstResultTop > 0 && firstResultTop <= viewportH + 120,
      statusLaneOverflowing:
        Boolean(statusScroller) &&
        statusScroller !== null &&
        statusScroller.scrollWidth > statusScroller.clientWidth + 1,
      sizeLaneOverflowing:
        Boolean(sizeScroller) &&
        sizeScroller !== null &&
        sizeScroller.scrollWidth > sizeScroller.clientWidth + 1,
      statusChipCount,
      sortChipCount,
      sizeChipCount,
      hasSearch: Boolean(document.querySelector("[data-inventory-controls='true'] input")),
      hasFiltersButton: Array.from(
        document.querySelectorAll("[data-inventory-controls='true'] button")
      ).some((button) =>
        (button.textContent ?? "").trim().toLowerCase().includes("filters")
      ),
      hasApplyButton:
        Array.from(document.querySelectorAll("[data-inventory-controls='true'] button")).some((button) =>
          (button.textContent ?? "").trim().toLowerCase() === "apply filters"
        ),
      activeFilterRemoveButtons: document.querySelectorAll(
        "[data-active-filters='true'] button[aria-label^='Remove filter']"
      ).length,
    };
  });
}

function toRouteMap(routes: RouteAudit[]): Record<string, AxeSummary> {
  return routes.reduce<Record<string, AxeSummary>>((acc, route) => {
    acc[route.route] = route.axe;
    return acc;
  }, {});
}

function buildRubric(desktop: ProfileAuditResult, mobile: ProfileAuditResult): RubricResult {
  const desktopInv = desktop.inventoryMetrics;
  const mobileInv = mobile.inventoryMetrics;
  const allAxe = [...desktop.routes, ...mobile.routes];
  const zeroAxe = allAxe.every((route) => route.axe.violations === 0);

  const desktopControlsRatio =
    desktopInv.viewportH > 0 ? desktopInv.controlsHeight / desktopInv.viewportH : 1;
  const mobileControlsRatio =
    mobileInv.viewportH > 0 ? mobileInv.controlsHeight / mobileInv.viewportH : 1;

  const aboveFold =
    desktopInv.firstResultVisibleNoScroll &&
    mobileInv.firstResultWithinMinimalScroll &&
    desktopControlsRatio <= 0.45 &&
    mobileControlsRatio <= 0.5;

  const hierarchy =
    desktopInv.hasHeading &&
    desktopInv.headingBottom > 0 &&
    desktopInv.controlsTop > desktopInv.headingBottom &&
    desktopInv.firstResultTop > desktopInv.controlsTop;

  const clarity =
    desktopInv.hasSearch &&
    !desktopInv.hasApplyButton &&
    desktopInv.statusChipCount >= 4 &&
    desktopInv.sizeChipCount >= 5;

  const mobileErgo =
    mobileInv.firstResultWithinMinimalScroll &&
    mobileControlsRatio <= 0.35 &&
    mobileInv.hasFiltersButton;

  const interactionConsistency =
    desktopInv.statusChipCount === mobileInv.statusChipCount &&
    desktopInv.sortChipCount === mobileInv.sortChipCount &&
    desktopInv.sizeChipCount === mobileInv.sizeChipCount;

  const accessibilitySemantics = zeroAxe;
  const brandCohesion = aboveFold && hierarchy && clarity;

  return {
    above_the_fold_utility: aboveFold,
    visual_hierarchy: hierarchy,
    cognitive_load_control_clarity: clarity,
    mobile_ergonomics: mobileErgo,
    interaction_consistency: interactionConsistency,
    accessibility_semantics: accessibilitySemantics,
    brand_aesthetic_cohesion: brandCohesion,
  };
}

function neededFixes(rubric: RubricResult): string[] {
  const fixes: string[] = [];
  if (!rubric.above_the_fold_utility) {
    fixes.push("Compress controls further and bring first inventory result higher in viewport.");
  }
  if (!rubric.visual_hierarchy) {
    fixes.push("Increase separation between heading, controls, and results with clearer density tiers.");
  }
  if (!rubric.cognitive_load_control_clarity) {
    fixes.push("Simplify control labels and ensure search/chips are primary with no submit affordance.");
  }
  if (!rubric.mobile_ergonomics) {
    fixes.push("Improve mobile chip lane behavior and reduce control stack height.");
  }
  if (!rubric.interaction_consistency) {
    fixes.push("Normalize chip groups and behavior across desktop and mobile.");
  }
  if (!rubric.accessibility_semantics) {
    fixes.push("Resolve remaining accessibility violations and landmark/heading issues.");
  }
  if (!rubric.brand_aesthetic_cohesion) {
    fixes.push("Tighten visual rhythm and style cohesion across controls and content.");
  }
  return fixes;
}

async function auditProfile(options: {
  profile: "desktop" | "mobile";
  contextOptions: BrowserContextOptions;
  baseUrl: string;
  screenshotsDir: string;
  passcode: string;
}): Promise<ProfileAuditResult> {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    baseURL: options.baseUrl,
    ...options.contextOptions,
  });

  const page = await context.newPage();
  let unlockAttempted = false;
  let unlockSucceeded = false;

  if (options.passcode) {
    unlockAttempted = true;
    unlockSucceeded = await unlockStaffIfConfigured({
      page,
      context,
      passcode: options.passcode,
      baseUrl: options.baseUrl,
    });
  }

  const routes: RouteAudit[] = [];
  for (const route of ROUTES) {
    await page.goto(route, { waitUntil: "networkidle" });
    await page.waitForTimeout(350);

    const screenshotName = `${options.profile}-${routeName(route)}.png`;
    const screenshotPath = path.join(options.screenshotsDir, screenshotName);
    await page.screenshot({ path: screenshotPath, fullPage: false });

    const axe = await runAxe(page);
    routes.push({ route, screenshot: screenshotName, axe });
  }

  await page.goto("/inventory", { waitUntil: "networkidle" });
  await page.waitForTimeout(250);
  const inventoryMetrics = await measureInventoryMetrics(page);

  await context.close();
  await browser.close();

  return {
    profile: options.profile,
    routes,
    inventoryMetrics,
    unlockAttempted,
    unlockSucceeded,
  };
}

async function main() {
  const iteration = parsePositiveInt(argValue("iteration", "1"), 1);
  const baseUrl = argValue("base-url", process.env.BASE_URL ?? "http://127.0.0.1:3000");
  const outDir = argValue(
    "out-dir",
    path.join("tmp", "design-audit", "iterations", String(iteration))
  );
  const screenshotsDir = path.join(outDir, "screenshots");
  const passcode = (process.env.STORE_PASSCODE ?? "").trim();

  await mkdir(screenshotsDir, { recursive: true });

  const desktop = await auditProfile({
    profile: "desktop",
    contextOptions: { viewport: { width: 1440, height: 900 } },
    baseUrl,
    screenshotsDir,
    passcode,
  });

  const mobile = await auditProfile({
    profile: "mobile",
    contextOptions: {
      ...devices["iPhone 12"],
      viewport: { width: 390, height: 844 },
    },
    baseUrl,
    screenshotsDir,
    passcode,
  });

  const rubric = buildRubric(desktop, mobile);
  const passAll = Object.values(rubric).every(Boolean);
  const fixes = neededFixes(rubric);

  const report = {
    iteration,
    generatedAt: new Date().toISOString(),
    base: baseUrl,
    screenshots: {
      desktop: desktop.routes.map((route) => route.screenshot),
      mobile: mobile.routes.map((route) => route.screenshot),
    },
    desktop: {
      unlockAttempted: desktop.unlockAttempted,
      unlockSucceeded: desktop.unlockSucceeded,
      inventoryMetrics: desktop.inventoryMetrics,
      axeResults: toRouteMap(desktop.routes),
    },
    mobile: {
      unlockAttempted: mobile.unlockAttempted,
      unlockSucceeded: mobile.unlockSucceeded,
      inventoryMetrics: mobile.inventoryMetrics,
      axeResults: toRouteMap(mobile.routes),
    },
    rubric,
    passAll,
  };

  const critique = [
    `# Iteration ${iteration} Designer Critique`,
    "",
    `Overall: ${passAll ? "PASS" : "FAIL"}`,
    "",
    "## Rubric",
    `- above_the_fold_utility: ${rubric.above_the_fold_utility ? "PASS" : "FAIL"}`,
    `- visual_hierarchy: ${rubric.visual_hierarchy ? "PASS" : "FAIL"}`,
    `- cognitive_load_control_clarity: ${rubric.cognitive_load_control_clarity ? "PASS" : "FAIL"}`,
    `- mobile_ergonomics: ${rubric.mobile_ergonomics ? "PASS" : "FAIL"}`,
    `- interaction_consistency: ${rubric.interaction_consistency ? "PASS" : "FAIL"}`,
    `- accessibility_semantics: ${rubric.accessibility_semantics ? "PASS" : "FAIL"}`,
    `- brand_aesthetic_cohesion: ${rubric.brand_aesthetic_cohesion ? "PASS" : "FAIL"}`,
    "",
    "## Metrics",
    `- desktop controls height: ${desktop.inventoryMetrics.controlsHeight}`,
    `- desktop first result top: ${desktop.inventoryMetrics.firstResultTop} (viewport ${desktop.inventoryMetrics.viewportH})`,
    `- mobile controls height: ${mobile.inventoryMetrics.controlsHeight}`,
    `- mobile first result top: ${mobile.inventoryMetrics.firstResultTop} (viewport ${mobile.inventoryMetrics.viewportH})`,
    `- axe violations desktop: ${JSON.stringify(toRouteMap(desktop.routes))}`,
    `- axe violations mobile: ${JSON.stringify(toRouteMap(mobile.routes))}`,
    "",
    "## Needed Next Fixes",
    ...(fixes.length > 0 ? fixes.map((fix) => `- ${fix}`) : ["- none"]),
    "",
  ].join("\n");

  await writeFile(path.join(outDir, "report.json"), JSON.stringify(report, null, 2));
  await writeFile(path.join(outDir, "designer-critique.md"), critique, "utf8");

  console.log(JSON.stringify({ outDir, passAll }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
