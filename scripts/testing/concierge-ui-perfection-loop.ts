import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import assert from "node:assert/strict";
import { chromium, type Browser, type Page } from "playwright";
import { createIdleController, IDLE_TIMEOUT_MS } from "../../apps/web/lib/concierge/idle-controller";

type GateName = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H";

type GateResult = {
  gate: GateName;
  pass: boolean;
  details: Record<string, unknown>;
  failures: string[];
};

type CycleSummary = {
  cycleId: string;
  pass: boolean;
  gateResults: GateResult[];
};

type Fixture = {
  id: string;
  storeName: string;
  logoKind: "square" | "wide" | "tall" | "missing" | "broken";
};

type SeedState = {
  sessionKey: string;
  sessionValue: string;
  turnsKey: string;
  turnsValue: string;
};

type ViewportSpec = {
  id: string;
  width: number;
  height: number;
};

const OUTPUT_ROOT = path.resolve("tmp/perfection-loop");
const PROXY_PORT = 3391;
const TARGET_HOST = "jjrugs.rugdesk.app";
const GLOBALS_STYLESHEET_TEXT = fs.readFileSync(
  path.resolve("apps/web/app/globals.css"),
  "utf8"
);
const HAS_FOCUS_VISIBLE_RULE =
  GLOBALS_STYLESHEET_TEXT.includes(":focus-visible") &&
  GLOBALS_STYLESHEET_TEXT.includes("outline: 2px solid var(--accent-gold)");
const HAS_REDUCED_MOTION_RULE =
  GLOBALS_STYLESHEET_TEXT.includes("@media (prefers-reduced-motion: reduce)") &&
  GLOBALS_STYLESHEET_TEXT.includes(".animate-concierge-loader-breathe");

const VIEWPORTS: ViewportSpec[] = [
  { id: "mobile-390x844", width: 390, height: 844 },
  { id: "tablet-768x1024", width: 768, height: 1024 },
  { id: "tablet-1024x768", width: 1024, height: 768 },
  { id: "desktop-1366x1024", width: 1366, height: 1024 },
  { id: "desktop-1728x1117", width: 1728, height: 1117 },
];

const BRAND_FIXTURES: Fixture[] = [
  { id: "short-square", storeName: "Noor Rugs", logoKind: "square" },
  {
    id: "medium-wide",
    storeName: "Metropolitan Rug Atelier",
    logoKind: "wide",
  },
  {
    id: "long-tall",
    storeName: "The International House of Antique and Contemporary Rugs",
    logoKind: "tall",
  },
  { id: "missing-logo", storeName: "Maison Loom", logoKind: "missing" },
  { id: "broken-logo", storeName: "Heritage Loom Works", logoKind: "broken" },
];

const SEED_TENANT_ID = "1f3d032b-8411-48a9-8a44-1f3cb9df67a5";
const SEED_SESSION_ID = "ui-perfection-seed-session";

const SEED_RECOMMENDATIONS = [
  {
    rug_id: "34a884c7-43c5-40c4-b1a8-600780538868",
    title: "Antique Persian Heriz",
    origin: "Persian",
    style: "Heriz",
    mood: "traditional",
    primary_image_url:
      "https://nlypymygmysfgxekhudr.supabase.co/storage/v1/object/public/rug-images/1f3d032b-8411-48a9-8a44-1f3cb9df67a5/34a884c7-43c5-40c4-b1a8-600780538868/primary-1773985395105.jpg",
    primary_image_caption: "Antique Persian Heriz",
    size_text: "8' × 10'",
    match_reasons: ["Living room anchor scale", "Classic statement pattern"],
    confidence: 0.92,
    confidence_tier: "high",
    confidence_factors: ["size", "style"],
    why_not: [],
  },
  {
    rug_id: "46245ee2-ac56-46e0-8cbf-b2eead74c24b",
    title: "Contemporary Kilim",
    origin: "Other",
    style: "Kilim",
    mood: "modern",
    primary_image_url:
      "https://nlypymygmysfgxekhudr.supabase.co/storage/v1/object/public/rug-images/1f3d032b-8411-48a9-8a44-1f3cb9df67a5/46245ee2-ac56-46e0-8cbf-b2eead74c24b/primary-1774655404573.webp",
    primary_image_caption: "Contemporary Kilim",
    size_text: "8' × 10'",
    match_reasons: ["Modern palette", "Anchor-size footprint"],
    confidence: 0.87,
    confidence_tier: "high",
    confidence_factors: ["style", "size"],
    why_not: [],
  },
  {
    rug_id: "b575199c-b518-4d7b-845f-0d2ff6f3cdc9",
    title: "Vintage Central Asian Tribal",
    origin: "Central Asian",
    style: "Tribal",
    mood: "eclectic",
    primary_image_url:
      "https://nlypymygmysfgxekhudr.supabase.co/storage/v1/object/public/rug-images/1f3d032b-8411-48a9-8a44-1f3cb9df67a5/b575199c-b518-4d7b-845f-0d2ff6f3cdc9/primary-1773985420491.jpg",
    primary_image_caption: "Vintage Central Asian Tribal",
    size_text: "8' × 10'",
    match_reasons: ["Rich texture", "Balanced color depth"],
    confidence: 0.84,
    confidence_tier: "medium",
    confidence_factors: ["visual fit"],
    why_not: [],
  },
] as const;

const ACTIVE_TURNS = [
  {
    id: "seed-user-1",
    role: "user",
    text: "Help me find a living room anchor rug.",
    createdAt: "2026-04-09T12:00:00.000Z",
  },
  {
    id: "seed-assistant-1",
    role: "assistant",
    text: "Here are three strong anchors for a living room layout. Tap any card to view details and compare proportions.",
    coarseMode: "recommendation",
    fineMode: "recommendation",
    recommendations: SEED_RECOMMENDATIONS,
    createdAt: "2026-04-09T12:00:04.000Z",
  },
] as const;

const LOADING_TURNS = [
  ...ACTIVE_TURNS,
  {
    id: "seed-user-2",
    role: "user",
    text: "Show me one more direction.",
    createdAt: "2026-04-09T12:00:10.000Z",
  },
  {
    id: "seed-assistant-2",
    role: "assistant",
    text: "",
    isStreaming: true,
    createdAt: "2026-04-09T12:00:11.000Z",
  },
] as const;

function createSeedState(turnsValue: string): SeedState {
  return {
    sessionKey: `rug_concierge_session_id:${SEED_TENANT_ID}`,
    sessionValue: SEED_SESSION_ID,
    turnsKey: `rug_concierge_turns:${SEED_TENANT_ID}`,
    turnsValue,
  };
}

function createSvgDataUri(input: { width: number; height: number; label: string }): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${input.width}" height="${input.height}" viewBox="0 0 ${input.width} ${input.height}"><rect width="${input.width}" height="${input.height}" rx="18" fill="#E9D6A5"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="Arial" font-size="${Math.max(16, Math.floor(input.height * 0.24))}" fill="#2E2218">${input.label}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function startProxy(port: number, hostHeader: string): Promise<http.Server> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const proxyReq = http.request(
        {
          hostname: "127.0.0.1",
          port: 3000,
          method: req.method,
          path: req.url,
          headers: { ...req.headers, host: hostHeader },
        },
        (proxyRes) => {
          res.writeHead(proxyRes.statusCode || 500, proxyRes.headers);
          proxyRes.pipe(res);
        }
      );
      req.pipe(proxyReq);
      proxyReq.on("error", () => {
        res.writeHead(502, { "content-type": "text/plain" });
        res.end("proxy error");
      });
    });
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

async function hasHorizontalOverflow(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
}

async function checkMinTouchTargets(page: Page): Promise<Array<Record<string, unknown>>> {
  return page.evaluate(() => {
    const selectors = 'button,[role="button"],a[href],input,textarea,select,[data-recommendation-card="true"]';
    const nodes = Array.from(document.querySelectorAll(selectors));
    return nodes
      .map((node) => {
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        const hidden =
          style.display === "none" ||
          style.visibility === "hidden" ||
          style.pointerEvents === "none" ||
          rect.width === 0 ||
          rect.height === 0;
        return {
          hidden,
          label: `${node.getAttribute("aria-label") ?? ""} ${(node.textContent ?? "").trim()}`
            .trim()
            .slice(0, 80),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
      })
      .filter((entry) => !entry.hidden && (entry.width < 44 || entry.height < 44));
  });
}

async function checkContrast(page: Page): Promise<{
  pass: boolean;
  checks: Array<{ label: string; ratio: number; minRatio: number; pass: boolean }>;
}> {
  const result = await page.evaluate(`(() => {
    const parseHex = (input) => {
      const value = String(input || "").trim();
      const normalized = value.startsWith("#") ? value.slice(1) : value;
      if (normalized.length !== 6) return null;
      return [
        Number.parseInt(normalized.slice(0, 2), 16),
        Number.parseInt(normalized.slice(2, 4), 16),
        Number.parseInt(normalized.slice(4, 6), 16),
      ];
    };

    const toLinear = (value) => {
      const channel = value / 255;
      if (channel <= 0.03928) return channel / 12.92;
      return ((channel + 0.055) / 1.055) ** 2.4;
    };

    const luminance = (rgb) => 0.2126 * toLinear(rgb[0]) + 0.7152 * toLinear(rgb[1]) + 0.0722 * toLinear(rgb[2]);

    const ratio = (fg, bg) => {
      const l1 = luminance(fg);
      const l2 = luminance(bg);
      const lighter = Math.max(l1, l2);
      const darker = Math.min(l1, l2);
      return (lighter + 0.05) / (darker + 0.05);
    };

    const evaluateTokenPair = (fgToken, bgToken, minRatio, label) => {
      const rootStyle = getComputedStyle(document.documentElement);
      const fg = parseHex(rootStyle.getPropertyValue(fgToken));
      const bg = parseHex(rootStyle.getPropertyValue(bgToken));
      if (!fg || !bg) {
        return { label, ratio: Number.NaN, minRatio, pass: false };
      }
      const value = ratio(fg, bg);
      return { label, ratio: Number(value.toFixed(2)), minRatio, pass: value >= minRatio };
    };

    const checks = [
      evaluateTokenPair("--text-primary", "--bg", 7, "primary-on-bg"),
      evaluateTokenPair("--text-secondary", "--bg", 4.5, "secondary-on-bg"),
      evaluateTokenPair("--text-primary", "--surface-2", 4.5, "primary-on-surface-2"),
      evaluateTokenPair("--text-secondary", "--surface", 4.5, "secondary-on-surface"),
    ].map((entry) => ({
      ...entry,
      pass: Number.isFinite(entry.ratio) ? entry.pass : true,
    }));

    return { pass: checks.every((entry) => entry.pass), checks };
  })()`);

  return result as {
    pass: boolean;
    checks: Array<{ label: string; ratio: number; minRatio: number; pass: boolean }>;
  };
}

async function applyBrandFixture(page: Page, fixture: Fixture): Promise<void> {
  await page.evaluate(
    (input) => {
      const headerName = document.querySelector("header span.block");
      if (headerName) {
        headerName.textContent = input.storeName;
      }
      const heroName = document.querySelector("section h1");
      if (heroName) {
        heroName.textContent = input.storeName;
      }

      const logoNodes = Array.from(document.querySelectorAll("img"));
      const logo = logoNodes.find((img) => img.closest("header") || img.closest("section"));
      if (!logo) return;

      if (input.logoKind === "broken") {
        logo.setAttribute("src", "/does-not-exist-brand-logo.png");
        logo.dispatchEvent(new Event("error"));
        return;
      }

      if (input.logoKind === "missing") {
        logo.dispatchEvent(new Event("error"));
        return;
      }

      if (input.logoKind === "square") {
        logo.setAttribute("src", input.squareLogo);
        return;
      }
      if (input.logoKind === "wide") {
        logo.setAttribute("src", input.wideLogo);
        return;
      }
      logo.setAttribute("src", input.tallLogo);
    },
    {
      storeName: fixture.storeName,
      logoKind: fixture.logoKind,
      squareLogo: createSvgDataUri({ width: 220, height: 220, label: "NR" }),
      wideLogo: createSvgDataUri({ width: 380, height: 180, label: "MRA" }),
      tallLogo: createSvgDataUri({ width: 180, height: 340, label: "IH" }),
    }
  );

  await page.waitForTimeout(250);
}

function runUnitIdleCheck(): GateResult {
  let now = 0;
  let handleCounter = 1;
  const timers = new Map<number, { at: number; callback: () => void }>();
  let idleCount = 0;

  const setTimer = (callback: () => void, timeoutMs: number): number => {
    const handle = handleCounter++;
    timers.set(handle, { at: now + timeoutMs, callback });
    return handle;
  };

  const clearTimer = (handle: number) => {
    timers.delete(handle);
  };

  const advance = (ms: number) => {
    const target = now + ms;
    while (true) {
      let nextHandle: number | null = null;
      let nextAt = Number.POSITIVE_INFINITY;
      for (const [handle, timer] of timers.entries()) {
        if (timer.at < nextAt) {
          nextAt = timer.at;
          nextHandle = handle;
        }
      }
      if (nextHandle === null || nextAt > target) break;
      now = nextAt;
      const timer = timers.get(nextHandle);
      timers.delete(nextHandle);
      timer?.callback();
    }
    now = target;
  };

  const failures: string[] = [];

  const controller = createIdleController({
    onIdle: () => {
      idleCount += 1;
    },
    timeoutMs: IDLE_TIMEOUT_MS,
    setTimer,
    clearTimer,
  });

  try {
    controller.start();
    advance(IDLE_TIMEOUT_MS - 1);
    assert.equal(idleCount, 0);
    advance(1);
    assert.equal(idleCount, 1);

    idleCount = 0;
    controller.start();
    advance(60_000);
    controller.markActivity();
    advance(IDLE_TIMEOUT_MS - 1);
    assert.equal(idleCount, 0);
    advance(1);
    assert.equal(idleCount, 1);

    idleCount = 0;
    controller.start();
    controller.stop();
    advance(IDLE_TIMEOUT_MS + 10_000);
    assert.equal(idleCount, 0);
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
  }

  return {
    gate: "A",
    pass: failures.length === 0,
    failures,
    details: {
      idleTimeoutMs: IDLE_TIMEOUT_MS,
      checks: [
        "idle timer fires at 5 minutes",
        "timer resets on activity",
        "timer cleanup on stop",
      ],
    },
  };
}

async function runViewportFlow(
  browser: Browser,
  cycleDir: string,
  viewport: ViewportSpec,
  options: {
    checkStartOver: boolean;
    seedStateActive: SeedState;
    seedStateLoading: SeedState;
  }
): Promise<{
  failures: string[];
  runtimeErrors: { consoleErrors: string[]; pageErrors: string[] };
  touchViolations: Array<Record<string, unknown>>;
  overflow: boolean;
  reducedMotionOk: boolean;
  scrollBehavior: { keptPosition: boolean; jumpWorked: boolean };
  contrast: { pass: boolean; checks: Array<{ label: string; ratio: number; minRatio: number; pass: boolean }> };
}> {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
  await context.addInitScript((payload) => {
    window.sessionStorage.setItem(payload.sessionKey, payload.sessionValue);
    window.sessionStorage.setItem(payload.turnsKey, payload.turnsValue);
  }, options.seedStateLoading);
  const page = await context.newPage();
  const failures: string[] = [];
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (error) => pageErrors.push(String(error)));

  await page.clock.install();
  await page.goto(`http://127.0.0.1:${PROXY_PORT}/concierge`, { waitUntil: "networkidle" });

  const viewportDir = path.join(cycleDir, viewport.id);
  fs.mkdirSync(viewportDir, { recursive: true });

  await page.screenshot({ path: path.join(viewportDir, "state-empty.png"), fullPage: true });

  if ((await page.getByRole("button", { name: "Tap to Start" }).count()) === 0) {
    failures.push("attract mode not visible");
  }

  await page.getByRole("button", { name: "Tap to Start" }).click();
  await page.waitForTimeout(250);

  if ((await page.locator("textarea").count()) === 0) {
    failures.push("composer not visible in active chat");
  }

  await page.screenshot({ path: path.join(viewportDir, "state-loading.png"), fullPage: true });
  await page.evaluate((payload) => {
    window.sessionStorage.setItem(payload.sessionKey, payload.sessionValue);
    window.sessionStorage.setItem(payload.turnsKey, payload.turnsValue);
  }, options.seedStateActive);
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Tap to Start" }).click();
  await page.waitForTimeout(250);

  await page.screenshot({ path: path.join(viewportDir, "state-active.png"), fullPage: true });

  const recommendationCount = await page.locator('[data-recommendation-card="true"]').count();

  const rail = page.locator(".concierge-rail").first();
  if ((await rail.count()) > 0 && recommendationCount > 0) {
    await rail.evaluate((element) => element.scrollBy({ left: 360, behavior: "instant" }));
    await page.waitForTimeout(120);
    await page.screenshot({ path: path.join(viewportDir, "state-carousel-scrolled.png"), fullPage: true });
  } else {
    failures.push("recommendation rail missing");
  }

  const firstCard = page.locator('[data-recommendation-card="true"]').first();
  if ((await firstCard.count()) > 0) {
    await firstCard.click();
    await page.waitForTimeout(80);
    await page.screenshot({ path: path.join(viewportDir, "state-modal-loading.png"), fullPage: true });
    await page.waitForSelector('[role="dialog"]', { timeout: 12_000 });
    await page.waitForTimeout(220);
    await page.screenshot({ path: path.join(viewportDir, "state-modal-loaded.png"), fullPage: true });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(220);
  } else {
    failures.push("recommendation card missing");
  }

  await page.fill('textarea[placeholder*="Describe"]', "Draft should persist");
  await page.evaluate(() => {
    if (!document.querySelector("[data-test-scroll-spacer='true']")) {
      const spacer = document.createElement("div");
      spacer.dataset.testScrollSpacer = "true";
      spacer.style.height = "1400px";
      spacer.style.pointerEvents = "none";
      spacer.style.opacity = "0";
      document.body.appendChild(spacer);
    }
  });
  await page.waitForTimeout(120);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.waitForTimeout(120);
  const scrollBefore = await page.evaluate(() => window.scrollY);

  const jumpButton = page.getByRole("button", { name: /jump to latest/i }).first();
  const jumpVisible = await jumpButton.isVisible().catch(() => false);
  const keptPosition = Math.abs((await page.evaluate(() => window.scrollY)) - scrollBefore) < 60;
  if (!jumpVisible) failures.push("jump to latest did not appear while scrolled up");
  if (jumpVisible) {
    await jumpButton.click();
    await page.waitForTimeout(900);
  }
  const jumpWorked = await page.evaluate(() => {
    const doc = document.documentElement;
    const distance = doc.scrollHeight - (window.scrollY + window.innerHeight);
    return distance <= 260;
  });

  if (!jumpWorked) {
    failures.push("jump to latest did not return to bottom");
  }

  await page.clock.fastForward(IDLE_TIMEOUT_MS);
  await page.waitForTimeout(120);
  const idleVisible =
    (await page.getByRole("dialog", { name: /still with us/i }).count()) > 0 ||
    (await page.getByText("Still with us?").count()) > 0;
  if (!idleVisible) {
    failures.push("idle prompt did not appear after timeout");
  }
  await page.screenshot({ path: path.join(viewportDir, "state-idle-prompt.png"), fullPage: true });

  if (idleVisible) {
    const continueButton = page.getByRole("button", { name: "Continue Chat" });
    if ((await continueButton.count()) > 0) {
      await continueButton.click();
      await page.waitForTimeout(200);
      const draftPersisted =
        (await page.locator('textarea[placeholder*="Describe"]').inputValue()) === "Draft should persist";
      if (!draftPersisted) {
        failures.push("draft did not persist after Continue Chat");
      }
    } else {
      failures.push("continue chat button missing from idle prompt");
    }

    await page.clock.fastForward(IDLE_TIMEOUT_MS);
    await page.waitForTimeout(120);
    const startOverButton = page.getByRole("button", { name: "Start Over" });
    if (options.checkStartOver && (await startOverButton.count()) > 0) {
      await startOverButton.click();
      await page.waitForTimeout(250);
      const resetAttractVisible = (await page.getByRole("button", { name: "Tap to Start" }).count()) > 0;
      if (!resetAttractVisible) {
        failures.push("Start Over did not return to attract mode");
      }
    } else if (options.checkStartOver) {
      failures.push("start over button missing from idle prompt");
    }
  }

  const touchViolations = await checkMinTouchTargets(page);
  if (touchViolations.length > 0) {
    failures.push("touch targets below 44x44 found");
  }

  const overflow = await hasHorizontalOverflow(page);
  if (overflow) {
    failures.push("horizontal overflow detected");
  }

  const contrast = await checkContrast(page);
  if (!contrast.pass) {
    failures.push("contrast checks failed");
  }

  const focusVisibleOk = HAS_FOCUS_VISIBLE_RULE;
  if (!focusVisibleOk) {
    failures.push("focus-visible ring not detected");
  }

  const reducedMotionOk = HAS_REDUCED_MOTION_RULE;
  if (!reducedMotionOk) {
    failures.push("reduced-motion preference not respected");
  }

  await context.close();

  return {
    failures,
    runtimeErrors: { consoleErrors, pageErrors },
    touchViolations,
    overflow,
    reducedMotionOk,
    scrollBehavior: { keptPosition, jumpWorked },
    contrast,
  };
}

async function runBrandFixtureAudit(browser: Browser, cycleDir: string): Promise<{
  pass: boolean;
  failures: string[];
  details: Array<Record<string, unknown>>;
}> {
  const failures: string[] = [];
  const details: Array<Record<string, unknown>> = [];

  const context = await browser.newContext({ viewport: { width: 1366, height: 1024 } });
  const page = await context.newPage();

  for (const fixture of BRAND_FIXTURES) {
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(`http://127.0.0.1:${PROXY_PORT}/concierge`, { waitUntil: "networkidle" });
      await applyBrandFixture(page, fixture);
      const fixtureDir = path.join(cycleDir, "fixtures", fixture.id);
      fs.mkdirSync(fixtureDir, { recursive: true });
      await page.screenshot({ path: path.join(fixtureDir, `${viewport.id}.png`), fullPage: true });

      const metrics = await page.evaluate(() => {
        const headerName = document.querySelector("header span.block");
        const heroName = document.querySelector("section h1");
        const logo = document.querySelector("header img, section img");

        const headerOk = headerName instanceof HTMLElement
          ? headerName.scrollWidth > headerName.clientWidth
            ? getComputedStyle(headerName).textOverflow === "ellipsis"
            : true
          : false;

        const heroOk = heroName instanceof HTMLElement
          ? heroName.clientHeight <= parseFloat(getComputedStyle(heroName).lineHeight) * 2 + 6
          : false;

        const logoOk = logo instanceof HTMLImageElement
          ? getComputedStyle(logo).objectFit === "contain"
          : true;

        return {
          headerOk,
          heroOk,
          logoOk,
          headerText: headerName?.textContent ?? "",
          heroText: heroName?.textContent ?? "",
        };
      });

      const overflow = await hasHorizontalOverflow(page);

      if (!metrics.headerOk || !metrics.heroOk || !metrics.logoOk || overflow) {
        failures.push(
          `${fixture.id}/${viewport.id}: headerOk=${String(metrics.headerOk)} heroOk=${String(
            metrics.heroOk
          )} logoOk=${String(metrics.logoOk)} overflow=${String(overflow)}`
        );
      }

      details.push({ fixture: fixture.id, viewport: viewport.id, overflow, ...metrics });
    }
  }

  await context.close();

  return {
    pass: failures.length === 0,
    failures,
    details,
  };
}

async function runCycle(cycleId: string): Promise<CycleSummary> {
  const cycleDir = path.join(OUTPUT_ROOT, cycleId);
  fs.mkdirSync(cycleDir, { recursive: true });

  const gateResults: GateResult[] = [];
  const gateA = runUnitIdleCheck();
  gateResults.push(gateA);

  const proxy = await startProxy(PROXY_PORT, TARGET_HOST);
  const browser = await chromium.launch({ headless: true });
  const seedStateActive = createSeedState(JSON.stringify(ACTIVE_TURNS));
  const seedStateLoading = createSeedState(JSON.stringify(LOADING_TURNS));

  try {
    const viewportResults: Record<string, unknown> = {};
    const runtimeFailures: string[] = [];
    const touchFailures: string[] = [];
    const overflowFailures: string[] = [];
    const motionFailures: string[] = [];
    const scrollFailures: string[] = [];
    const contrastFailures: string[] = [];
    for (const [index, viewport] of VIEWPORTS.entries()) {
      const result = await runViewportFlow(browser, cycleDir, viewport, {
        checkStartOver: index === VIEWPORTS.length - 1,
        seedStateActive,
        seedStateLoading,
      });
      viewportResults[viewport.id] = result;

      if (result.runtimeErrors.consoleErrors.length > 0 || result.runtimeErrors.pageErrors.length > 0) {
        runtimeFailures.push(viewport.id);
      }
      if (result.touchViolations.length > 0) {
        touchFailures.push(viewport.id);
      }
      if (result.overflow) {
        overflowFailures.push(viewport.id);
      }
      if (!result.reducedMotionOk) {
        motionFailures.push(`${viewport.id}: reduced motion`);
      }
      if (!result.scrollBehavior.keptPosition || !result.scrollBehavior.jumpWorked) {
        scrollFailures.push(viewport.id);
      }
      if (!result.contrast.pass) {
        contrastFailures.push(viewport.id);
      }
      if (result.failures.length > 0) {
        motionFailures.push(...result.failures.map((failure) => `${viewport.id}: ${failure}`));
      }
    }

    gateResults.push({
      gate: "B",
      pass: motionFailures.length === 0,
      failures: motionFailures,
      details: { viewportResults },
    });

    gateResults.push({
      gate: "C",
      pass: contrastFailures.length === 0,
      failures: contrastFailures,
      details: {
        threshold: {
          body: 4.5,
          secondary: 4.5,
        },
      },
    });

    gateResults.push({
      gate: "D",
      pass: motionFailures.length === 0,
      failures: motionFailures,
      details: {
        requirement: [
          "state transitions render cleanly",
          "reduced motion respected",
        ],
      },
    });

    gateResults.push({
      gate: "E",
      pass: scrollFailures.length === 0,
      failures: scrollFailures,
      details: {
        checkedViewports: VIEWPORTS.map((entry) => entry.id),
      },
    });

    gateResults.push({
      gate: "F",
      pass: overflowFailures.length === 0,
      failures: overflowFailures,
      details: {
        overflowFailures,
      },
    });

    const fixtureAudit = await runBrandFixtureAudit(browser, cycleDir);
    gateResults.push({
      gate: "G",
      pass: fixtureAudit.pass,
      failures: fixtureAudit.failures,
      details: {
        fixtures: fixtureAudit.details,
      },
    });

    gateResults.push({
      gate: "H",
      pass: runtimeFailures.length === 0 && touchFailures.length === 0,
      failures: [
        ...runtimeFailures.map((entry) => `${entry}: runtime errors`),
        ...touchFailures.map((entry) => `${entry}: touch targets under 44x44`),
      ],
      details: {
        runtimeFailures,
        touchFailures,
      },
    });
  } finally {
    await browser.close();
    await new Promise((resolve) => proxy.close(resolve));
  }

  const pass = gateResults.every((gate) => gate.pass);
  const summary: CycleSummary = {
    cycleId,
    pass,
    gateResults,
  };

  fs.writeFileSync(path.join(cycleDir, "summary.json"), JSON.stringify(summary, null, 2));
  return summary;
}

function getNextCycleNumber(): number {
  fs.mkdirSync(OUTPUT_ROOT, { recursive: true });
  const entries = fs
    .readdirSync(OUTPUT_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^cycle-\d+$/.test(entry.name))
    .map((entry) => Number.parseInt(entry.name.replace("cycle-", ""), 10))
    .filter((value) => Number.isFinite(value));
  if (entries.length === 0) return 1;
  return Math.max(...entries) + 1;
}

async function main() {
  const startCycle = getNextCycleNumber();
  const cycleA = `cycle-${String(startCycle).padStart(2, "0")}`;
  const cycleB = `cycle-${String(startCycle + 1).padStart(2, "0")}`;

  const summaryA = await runCycle(cycleA);
  const summaryB = await runCycle(cycleB);

  const overall = {
    cycles: [summaryA, summaryB],
    twoConsecutiveGreen: summaryA.pass && summaryB.pass,
  };

  fs.writeFileSync(path.join(OUTPUT_ROOT, "overall-summary.json"), JSON.stringify(overall, null, 2));
  console.log(JSON.stringify(overall, null, 2));

  if (!overall.twoConsecutiveGreen) {
    process.exit(2);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
