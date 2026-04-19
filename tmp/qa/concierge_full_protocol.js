const fs = require('fs');
const path = require('path');
const http = require('http');
const { chromium } = require('playwright');

function startProxy(port, hostHeader) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const proxyReq = http.request(
        {
          hostname: '127.0.0.1',
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
      proxyReq.on('error', () => {
        res.writeHead(502, { 'content-type': 'text/plain' });
        res.end('proxy error');
      });
    });
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

async function send(page, text) {
  const box = page.locator('textarea[placeholder*="Describe"]');
  await box.waitFor({ state: 'visible', timeout: 15000 });
  await box.fill(text);
  const sendButton = page.locator('button', { hasText: /^Send$/i }).first();
  if ((await sendButton.count()) > 0) {
    await sendButton.click();
    return;
  }
  await page.keyboard.press('Enter');
}

async function waitForResponse(page, timeout = 36000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const loading = await page.locator('text=Searching the collection').count();
    if (loading === 0) return true;
    await page.waitForTimeout(300);
  }
  return false;
}

async function hasHorizontalOverflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
}

async function checkModalTargets(page) {
  return page.evaluate(() => {
    const modal = document.querySelector('[role="dialog"]');
    if (!modal) {
      return { modalFound: false, smallTargets: [{ reason: 'modal-not-found' }], closeCount: 0 };
    }

    const actionableSelectors = 'button,[role="button"],a[href],input,textarea,select';
    const els = Array.from(modal.querySelectorAll(actionableSelectors));
    const smallTargets = els
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        const hidden =
          style.display === 'none' ||
          style.visibility === 'hidden' ||
          style.pointerEvents === 'none' ||
          rect.width === 0 ||
          rect.height === 0;
        return {
          hidden,
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          text: ((el.getAttribute('aria-label') || '') + ' ' + (el.textContent || '')).trim().slice(0, 60),
        };
      })
      .filter((item) => !item.hidden && (item.width < 44 || item.height < 44));

    const closeCandidates = Array.from(modal.querySelectorAll('button,[role="button"]')).filter((el) => {
      const label = `${el.getAttribute('aria-label') || ''} ${(el.textContent || '').trim()}`.toLowerCase();
      return label.includes('close');
    });

    return {
      modalFound: true,
      smallTargets,
      closeCount: closeCandidates.length,
    };
  });
}

async function checkDockObscured(page) {
  return page.evaluate(() => {
    const dock = document.querySelector('[data-concierge-composer="true"]');
    if (!dock) return { ok: false, reason: 'dock-not-found' };
    const dockRect = dock.getBoundingClientRect();

    const cards = Array.from(document.querySelectorAll('[data-recommendation-card="true"]'));
    const lastCard = cards.length > 0 ? cards[cards.length - 1] : null;
    const lastArticle = Array.from(document.querySelectorAll('article')).pop() || null;
    const target = lastCard || lastArticle;
    if (!target) return { ok: false, reason: 'content-target-not-found' };

    const rect = target.getBoundingClientRect();
    const obscured = rect.bottom > dockRect.top - 6;
    return {
      ok: !obscured,
      targetBottom: Math.round(rect.bottom),
      dockTop: Math.round(dockRect.top),
    };
  });
}

async function headerStyleGate(page) {
  return page.evaluate(() => {
    const header = document.querySelector('header');
    if (!header) return { ok: false, reason: 'header-not-found' };
    const style = getComputedStyle(header);
    const hasDivider = (style.borderBottomWidth || '0px') !== '0px';
    const blur = style.backdropFilter || '';
    const noneOrLightBlur = blur === 'none' || blur.includes('blur(2px)') || blur.includes('blur(1px)') || blur.includes('blur(0');
    return {
      ok: hasDivider && noneOrLightBlur,
      borderBottomWidth: style.borderBottomWidth,
      backdropFilter: blur,
      backgroundColor: style.backgroundColor,
    };
  });
}

async function runViewport(browser, outDir, viewport) {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => {
    pageErrors.push(String(err));
  });

  const label = `${viewport.width}x${viewport.height}`;

  await page.goto('http://127.0.0.1:3211/concierge', { waitUntil: 'networkidle' });
  await page.screenshot({ path: path.join(outDir, `${label}-01-empty.png`) });
  const emptyOverflow = await hasHorizontalOverflow(page);

  const requests = [
    'Show me rugs for a living room anchor area',
    'Show me rugs',
    'Show me a range of rugs',
  ];
  let responded = false;
  for (const request of requests) {
    await send(page, request);
    await page.waitForTimeout(400);
    responded = await waitForResponse(page);
    if (responded) {
      const cardCount = await page.locator('[data-recommendation-card=\"true\"]').count();
      if (cardCount > 0) break;
    }
  }
  await page.screenshot({ path: path.join(outDir, `${label}-02-loading.png`) });
  await page.screenshot({ path: path.join(outDir, `${label}-03-active.png`) });

  const rail = page.locator('.concierge-rail').first();
  if ((await rail.count()) > 0) {
    await page.evaluate(() => {
      const row = document.querySelector('.concierge-rail');
      if (row) row.scrollBy({ left: 360, behavior: 'instant' });
    });
    await page.waitForTimeout(200);
  }
  await page.screenshot({ path: path.join(outDir, `${label}-04-rail-scrolled.png`) });

  let modalLoadingCaptured = false;
  let firstDelay = true;
  await page.route('**/api/rugs/*', async (route) => {
    if (firstDelay) {
      firstDelay = false;
      await new Promise((resolve) => setTimeout(resolve, 1300));
    }
    await route.continue();
  });

  const firstCard = page.locator('[data-recommendation-card="true"]').first();
  if ((await firstCard.count()) > 0) {
    await firstCard.click();
    await page.locator('[role="dialog"]').waitFor({ state: 'visible', timeout: 10000 });
    await page.screenshot({ path: path.join(outDir, `${label}-05-modal-loading.png`) });
    modalLoadingCaptured = true;
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(outDir, `${label}-06-modal-loaded.png`) });
  }

  const modalAudit = await checkModalTargets(page);
  const modalOpen = await page.locator('[role="dialog"]').count();
  if (modalOpen > 0) {
    const closeButton = page.locator('[role="dialog"] button').filter({ hasText: /^$/ }).first();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    if ((await page.locator('[role="dialog"]').count()) > 0 && (await closeButton.count()) > 0) {
      await closeButton.click({ force: true });
    }
  }

  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.waitForTimeout(200);
  await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(outDir, `${label}-07-scroll-bottom.png`) });

  const activeOverflow = await hasHorizontalOverflow(page);
  const headerGate = await headerStyleGate(page);
  const dockCheck = (viewport.width === 390 || viewport.width === 1366)
    ? await checkDockObscured(page)
    : { ok: true, skipped: true };

  await context.close();

  return {
    viewport: label,
    emptyOverflow,
    activeOverflow,
    responded,
    modalLoadingCaptured,
    modalAudit,
    headerGate,
    dockCheck,
    consoleErrors,
    pageErrors,
  };
}

async function run(runName) {
  const outDir = path.resolve(`tmp/qa/concierge-redesign/${runName}`);
  fs.mkdirSync(outDir, { recursive: true });

  const proxy = await startProxy(3211, 'jjrugs.rugdesk.app');
  const browser = await chromium.launch({ headless: true });

  const viewports = [
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1366, height: 1024 },
    { width: 1728, height: 1117 },
  ];

  const results = [];
  try {
    for (const vp of viewports) {
      results.push(await runViewport(browser, outDir, vp));
    }
  } finally {
    await browser.close();
    await new Promise((resolve) => proxy.close(resolve));
  }

  const failures = [];
  for (const r of results) {
    if (r.emptyOverflow || r.activeOverflow) failures.push(`${r.viewport}: overflow`);
    if (!r.responded) failures.push(`${r.viewport}: loading did not resolve`);
    if (r.modalAudit.smallTargets.length > 0) failures.push(`${r.viewport}: modal target <44x44`);
    if (r.modalAudit.closeCount !== 1) failures.push(`${r.viewport}: close affordances=${r.modalAudit.closeCount}`);
    if (!r.headerGate.ok) failures.push(`${r.viewport}: header style gate`);
    if (!r.dockCheck.ok) failures.push(`${r.viewport}: dock overlap`);
    if (r.consoleErrors.length > 0) failures.push(`${r.viewport}: console errors`);
    if (r.pageErrors.length > 0) failures.push(`${r.viewport}: page errors`);
  }

  const summary = {
    outDir,
    pass: failures.length === 0,
    failures,
    results,
  };
  fs.writeFileSync(path.join(outDir, 'full-protocol-results.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.pass) process.exit(2);
}

run(process.argv[2] || 'protocol-run').catch((error) => {
  console.error(error);
  process.exit(1);
});
