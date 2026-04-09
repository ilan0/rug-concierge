import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { chromium, type Page } from "playwright";
import { createIdleController, IDLE_TIMEOUT_MS } from "../../apps/web/lib/concierge/idle-controller";

type GateResult = {
  gate: string;
  pass: boolean;
  details: Record<string, unknown>;
};

type FullRunResult = {
  runId: string;
  pass: boolean;
  gateResults: GateResult[];
};

const OUTPUT_ROOT = path.resolve("tmp/qa/concierge-attract-idle");

type Fixture = {
  id: string;
  storeName: string;
  logoKind: "square" | "wide" | "tall" | "missing" | "broken";
};

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

function createSvgDataUri(input: {
  width: number;
  height: number;
  label: string;
}): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${input.width}" height="${input.height}" viewBox="0 0 ${input.width} ${input.height}"><rect width="${input.width}" height="${input.height}" rx="18" fill="#E9D6A5"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="Arial" font-size="${Math.max(18, Math.floor(input.height * 0.28))}" fill="#2E2218">${input.label}</text></svg>`;
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

async function waitForLoadingToEnd(page: Page, timeoutMs = 25_000): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const loadingCount = await page.locator("text=Searching the collection").count();
    if (loadingCount === 0) return true;
    await page.waitForTimeout(250);
  }
  return false;
}

async function sendMessage(page: Page, text: string): Promise<void> {
  const textarea = page.locator('textarea[placeholder*="Describe"]').first();
  await textarea.waitFor({ state: "visible", timeout: 15_000 });
  await textarea.fill(text);
  const sendButton = page.getByRole("button", { name: /^Send$/ });
  await sendButton.click();
}

async function ensureRecommendations(page: Page): Promise<boolean> {
  const prompts = [
    "Show me a range of rugs",
    "Show me rugs",
    "Help me browse the collection",
  ];
  for (const prompt of prompts) {
    await sendMessage(page, prompt);
    const responded = await waitForLoadingToEnd(page);
    if (!responded) continue;
    const count = await page.locator('[data-recommendation-card="true"]').count();
    if (count > 0) return true;
  }
  return false;
}

async function applyBrandFixture(page: Page, fixture: Fixture): Promise<void> {
  await page.evaluate((input) => {
    const headerName = document.querySelector("header span.truncate");
    if (headerName) {
      headerName.textContent = input.storeName;
      (headerName as HTMLElement).style.maxWidth = "320px";
    }
    const heroName = Array.from(document.querySelectorAll("h1")).find((h1) =>
      h1.textContent?.trim().length
    );
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
  }, {
    storeName: fixture.storeName,
    logoKind: fixture.logoKind,
    squareLogo: createSvgDataUri({ width: 220, height: 220, label: "NR" }),
    wideLogo: createSvgDataUri({ width: 380, height: 180, label: "MRA" }),
    tallLogo: createSvgDataUri({ width: 180, height: 340, label: "IH" }),
  });

  await page.waitForTimeout(250);
}

async function checkMinTouchTargets(page: Page): Promise<unknown[]> {
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
          label: `${node.getAttribute("aria-label") ?? ""} ${(node.textContent ?? "").trim()}`.trim().slice(0, 60),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
      })
      .filter((entry) => !entry.hidden && (entry.width < 44 || entry.height < 44));
  });
}

function runUnitGateA(): GateResult {
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

  const controller = createIdleController({
    onIdle: () => {
      idleCount += 1;
    },
    timeoutMs: IDLE_TIMEOUT_MS,
    setTimer,
    clearTimer,
  });

  controller.start();
  advance(IDLE_TIMEOUT_MS - 1);
  assert.equal(idleCount, 0, "idle fired too early");
  advance(1);
  assert.equal(idleCount, 1, "idle did not fire at 5 minutes");

  idleCount = 0;
  controller.start();
  advance(120_000);
  controller.markActivity();
  advance(IDLE_TIMEOUT_MS - 1);
  assert.equal(idleCount, 0, "timer did not reset after activity");
  advance(1);
  assert.equal(idleCount, 1, "reset timer did not eventually fire");

  idleCount = 0;
  controller.start();
  controller.stop();
  advance(IDLE_TIMEOUT_MS + 20_000);
  assert.equal(idleCount, 0, "timer was not cleaned up on stop");

  return {
    gate: "A",
    pass: true,
    details: {
      idleTimeoutMs: IDLE_TIMEOUT_MS,
      checks: [
        "fires at exactly 5min",
        "resets on activity",
        "cleanup on stop/unmount path",
      ],
    },
  };
}

async function runBrowserGates(runId: string): Promise<GateResult[]> {
  const runDir = path.join(OUTPUT_ROOT, runId);
  fs.mkdirSync(runDir, { recursive: true });

  const proxy = await startProxy(3291, "jjrugs.rugdesk.app");
  const browser = await chromium.launch({ headless: true });

  const gateDetails: {
    integration: Record<string, unknown>;
    e2e: Record<string, unknown>;
    fixtures: Record<string, unknown>;
    a11y: Record<string, unknown>;
    runtime: Record<string, unknown>;
  } = {
    integration: {},
    e2e: {},
    fixtures: {},
    a11y: {},
    runtime: {},
  };

  const failures: string[] = [];

  try {
    const context = await browser.newContext({ viewport: { width: 1366, height: 1024 } });
    const page = await context.newPage();
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (error) => pageErrors.push(String(error)));

    await page.clock.install();
    await page.goto("http://127.0.0.1:3291/concierge", { waitUntil: "networkidle" });
    await page.screenshot({ path: path.join(runDir, "state-empty.png") });

    const attractVisible = (await page.getByRole("button", { name: "Tap to Start" }).count()) > 0;
    if (!attractVisible) failures.push("B: attract mode not shown on fresh load");

    await page.clock.fastForward(IDLE_TIMEOUT_MS);
    const idleBeforeStart = await page.getByRole("dialog").count();
    if (idleBeforeStart > 0) failures.push("B: idle modal appeared before entering active chat");

    await page.getByRole("button", { name: "Tap to Start" }).click();
    await page.waitForTimeout(250);
    const composerVisible = (await page.locator("textarea").count()) > 0;
    if (!composerVisible) failures.push("B: active chat composer did not appear after tap start");

    const recommendationsReady = await ensureRecommendations(page);
    if (!recommendationsReady) failures.push("C: could not load recommendation rail");

    await page.screenshot({ path: path.join(runDir, "state-active.png") });

    await page.fill('textarea[placeholder*="Describe"]', "draft that should survive idle");
    await page.evaluate(() =>
      window.scrollTo({
        top: Math.max(0, document.documentElement.scrollHeight - 450),
        behavior: "instant",
      })
    );
    const turnCountBefore = await page.locator("article").count();

    const rail = page.locator(".concierge-rail").first();
    if ((await rail.count()) > 0) {
      await rail.evaluate((el) => el.scrollBy({ left: 360, behavior: "instant" }));
    }

    const firstCard = page.locator('[data-recommendation-card="true"]').first();
    if ((await firstCard.count()) > 0) {
      await firstCard.click();
      await page.waitForSelector('[role="dialog"]', { timeout: 10_000 });
      await page.screenshot({ path: path.join(runDir, "state-modal-loaded.png") });
      await page.keyboard.press("Escape");
      await page.waitForTimeout(200);
    }

    const scrollBefore = await page.evaluate(() => window.scrollY);

    await page.clock.fastForward(IDLE_TIMEOUT_MS);
    const idleShown = (await page.getByRole("dialog").count()) > 0;
    if (!idleShown) failures.push("B: idle prompt did not appear after 5 min inactivity");
    await page.screenshot({ path: path.join(runDir, "state-idle-prompt.png") });

    await page.getByRole("button", { name: "Continue Chat" }).click();
    await page.waitForTimeout(250);
    const idleClosed = (await page.getByRole("dialog").count()) === 0;
    if (!idleClosed) failures.push("B: idle prompt did not close on Continue Chat");

    const draftAfterContinue = await page.locator("textarea").inputValue();
    const turnCountAfterContinue = await page.locator("article").count();
    const scrollAfterContinue = await page.evaluate(() => window.scrollY);
    if (draftAfterContinue !== "draft that should survive idle") {
      failures.push("B: draft did not persist after Continue Chat");
    }
    if (turnCountAfterContinue !== turnCountBefore) {
      failures.push("B: thread state changed unexpectedly after Continue Chat");
    }
    if (Math.abs(scrollAfterContinue - scrollBefore) > 24) {
      failures.push("B: scroll position was not preserved after Continue Chat");
    }

    await page.clock.fastForward(IDLE_TIMEOUT_MS);
    const idleShownAgain = (await page.getByRole("dialog").count()) > 0;
    if (!idleShownAgain) failures.push("C: idle prompt did not reappear on second idle cycle");

    await page.getByRole("button", { name: "Start Over" }).click();
    await page.waitForTimeout(400);
    const attractAfterReset = (await page.getByRole("button", { name: "Tap to Start" }).count()) > 0;
    const composerAfterReset = (await page.locator("textarea").count()) > 0;
    if (!attractAfterReset || composerAfterReset) {
      failures.push("B: Start Over did not return to attract mode cleanly");
    }

    await page.getByRole("button", { name: "Tap to Start" }).click();
    await page.waitForTimeout(250);
    const freshTurnCount = await page.locator("article").count();
    if (freshTurnCount !== 1) {
      failures.push("B: Start Over did not clear front-end chat UI state");
    }

    const minTargets = await checkMinTouchTargets(page);
    if (minTargets.length > 0) {
      failures.push("E: actionable targets below 44x44");
    }

    await page.keyboard.press("Tab");
    const focusVisibleOk = await page.evaluate(() => {
      const active = document.activeElement;
      if (!(active instanceof HTMLElement)) return false;
      const style = getComputedStyle(active);
      const outlineVisible =
        style.outlineWidth === "2px" &&
        style.outlineColor !== "rgba(0, 0, 0, 0)";
      return outlineVisible;
    });
    if (!focusVisibleOk) {
      failures.push("E: focus-visible ring not detected");
    }

    const reducedMotionContext = await browser.newContext({
      viewport: { width: 768, height: 1024 },
      reducedMotion: "reduce",
    });
    const reducedMotionPage = await reducedMotionContext.newPage();
    await reducedMotionPage.goto("http://127.0.0.1:3291/concierge", { waitUntil: "networkidle" });
    await reducedMotionPage.getByRole("button", { name: "Tap to Start" }).click();
    await reducedMotionPage.waitForTimeout(250);
    await sendMessage(reducedMotionPage, "Show me rugs");
    await reducedMotionPage.waitForTimeout(450);
    const reducedMotionResult = await reducedMotionPage.evaluate(() => {
      const loadingLine = document.querySelector(".concierge-loading-line");
      if (!(loadingLine instanceof HTMLElement)) return { ok: true, reason: "loading-not-visible" };
      const style = getComputedStyle(loadingLine);
      return { ok: style.animationName === "none", animationName: style.animationName };
    });
    if (!reducedMotionResult.ok) {
      failures.push("E: reduced motion not respected");
    }
    await reducedMotionContext.close();

    gateDetails.integration = {
      attractVisible,
      idleBeforeStart,
      composerVisible,
      draftAfterContinue,
      turnCountBefore,
      turnCountAfterContinue,
      scrollBefore,
      scrollAfterContinue,
      attractAfterReset,
      freshTurnCount,
    };
    gateDetails.e2e = {
      recommendationsReady,
      modalInteraction: true,
      idleShown,
      idleShownAgain,
    };
    gateDetails.a11y = {
      smallTargets: minTargets,
      focusVisibleOk,
      reducedMotionResult,
    };
    gateDetails.runtime = {
      consoleErrors,
      pageErrors,
    };

    if (consoleErrors.length > 0 || pageErrors.length > 0) {
      failures.push("F: runtime errors detected");
    }

    await context.close();

    const fixtureContext = await browser.newContext({ viewport: { width: 1366, height: 1024 } });
    const fixturePage = await fixtureContext.newPage();
    const fixtureResults: Array<Record<string, unknown>> = [];
    for (const fixture of BRAND_FIXTURES) {
      await fixturePage.goto("http://127.0.0.1:3291/concierge", { waitUntil: "networkidle" });
      await applyBrandFixture(fixturePage, fixture);
      await fixturePage.screenshot({
        path: path.join(runDir, `fixture-${fixture.id}-desktop.png`),
      });

      await fixturePage.setViewportSize({ width: 390, height: 844 });
      await fixturePage.goto("http://127.0.0.1:3291/concierge", { waitUntil: "networkidle" });
      await applyBrandFixture(fixturePage, fixture);
      await fixturePage.screenshot({
        path: path.join(runDir, `fixture-${fixture.id}-mobile.png`),
      });

      const overflow = await hasHorizontalOverflow(fixturePage);
      const textWrapMetrics = await fixturePage.evaluate(() => {
        const headerName = document.querySelector("header span.truncate");
        const heroName = document.querySelector("h1");
        if (!(headerName instanceof HTMLElement) || !(heroName instanceof HTMLElement)) {
          return {
            ok: false,
            missing: true,
          };
        }
        const headerStyle = getComputedStyle(headerName);
        const parsedHeaderLineHeight = parseFloat(headerStyle.lineHeight);
        const headerLineHeight = Number.isFinite(parsedHeaderLineHeight)
          ? parsedHeaderLineHeight
          : parseFloat(headerStyle.fontSize) * 1.2;
        const headerOneLine = headerName.clientHeight <= headerLineHeight + 2;
        const heroStyle = getComputedStyle(heroName);
        const fallbackLineHeight = parseFloat(heroStyle.fontSize) * 1.2;
        const parsedLineHeight = parseFloat(heroStyle.lineHeight);
        const lineHeight = Number.isFinite(parsedLineHeight)
          ? parsedLineHeight
          : fallbackLineHeight;
        const heroTwoLinesOrLess = heroName.clientHeight <= lineHeight * 2 + 4;
        return {
          ok: headerOneLine && heroTwoLinesOrLess,
          headerOneLine,
          heroTwoLinesOrLess,
          headerClientHeight: headerName.clientHeight,
          headerLineHeight,
          heroClientHeight: heroName.clientHeight,
          heroLineHeight: lineHeight,
        };
      });
      fixtureResults.push({
        fixture: fixture.id,
        overflow,
        textWrapOk: textWrapMetrics.ok,
        textWrapMetrics,
      });
    }
    await fixtureContext.close();
    gateDetails.fixtures = {
      fixtures: fixtureResults,
    };

    if (fixtureResults.some((item) => item.overflow || !item.textWrapOk)) {
      failures.push("D: one or more brand fixtures rendered poorly");
    }
  } finally {
    await browser.close();
    await new Promise((resolve) => proxy.close(resolve));
  }

  const resultB: GateResult = {
    gate: "B",
    pass: !failures.some((value) => value.startsWith("B:")),
    details: gateDetails.integration,
  };
  const resultC: GateResult = {
    gate: "C",
    pass: !failures.some((value) => value.startsWith("C:")),
    details: gateDetails.e2e,
  };
  const resultD: GateResult = {
    gate: "D",
    pass: !failures.some((value) => value.startsWith("D:")),
    details: gateDetails.fixtures,
  };
  const resultE: GateResult = {
    gate: "E",
    pass: !failures.some((value) => value.startsWith("E:")),
    details: gateDetails.a11y,
  };
  const resultF: GateResult = {
    gate: "F",
    pass: !failures.some((value) => value.startsWith("F:")),
    details: gateDetails.runtime,
  };

  const all = [resultB, resultC, resultD, resultE, resultF];
  if (failures.length > 0) {
    const detailsFile = path.join(runDir, "failures.json");
    fs.writeFileSync(detailsFile, JSON.stringify({ failures }, null, 2));
  }
  return all;
}

async function runSingle(runId: string): Promise<FullRunResult> {
  const gateResults: GateResult[] = [];

  gateResults.push(runUnitGateA());
  const browserGateResults = await runBrowserGates(runId);
  gateResults.push(...browserGateResults);

  const pass = gateResults.every((gate) => gate.pass);
  const summary = { runId, pass, gateResults };
  const outDir = path.join(OUTPUT_ROOT, runId);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
  return summary;
}

async function main() {
  fs.mkdirSync(OUTPUT_ROOT, { recursive: true });
  const runA = await runSingle("full-run-1");
  const runB = await runSingle("full-run-2");

  const overall = {
    runA,
    runB,
    twoConsecutiveGreen: runA.pass && runB.pass,
  };

  fs.writeFileSync(
    path.join(OUTPUT_ROOT, "overall-summary.json"),
    JSON.stringify(overall, null, 2)
  );
  console.log(JSON.stringify(overall, null, 2));

  if (!overall.twoConsecutiveGreen) {
    process.exit(2);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

function hasHorizontalOverflow(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
}
