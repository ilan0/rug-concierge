const fs = require('fs');
const path = require('path');
const { chromium, webkit } = require('playwright');

const BASE_URL = 'http://127.0.0.1:3000';
const OUT_DIR = path.join('tmp', 'concierge-real-cases');

function ensureOutDir() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

async function setRoleCookies(context, role = 'retail_customer') {
  await context.addCookies([
    { name: 'rug_ui_role', value: role, url: `${BASE_URL}/`, sameSite: 'Lax' },
    { name: 'rug_ui_tenant_id', value: 'demo-tenant', url: `${BASE_URL}/`, sameSite: 'Lax' },
  ]);
}

async function openConcierge(context, browserLabel, viewportLabel, captureLog) {
  const page = await context.newPage();
  page.setDefaultTimeout(30000);

  page.on('response', async (response) => {
    if (!response.url().includes('/api/chat')) return;
    if (response.request().method() !== 'POST') return;

    let requestBody = null;
    let responseBody = null;
    try {
      requestBody = response.request().postDataJSON();
    } catch {}
    try {
      responseBody = await response.json();
    } catch {}

    const recommendations = responseBody?.response?.recommendations ?? [];
    captureLog.push({
      browser: browserLabel,
      viewport: viewportLabel,
      status: response.status(),
      message: requestBody?.message ?? null,
      mode: responseBody?.mode ?? responseBody?.response?.mode ?? null,
      recommendationCount: Array.isArray(recommendations) ? recommendations.length : 0,
      recommendations: Array.isArray(recommendations)
        ? recommendations.map((item) => ({
            rug_id: item.rug_id,
            title: item.title,
            primary_image_url: item.primary_image_url,
            hasImage: typeof item.primary_image_url === 'string' && item.primary_image_url.trim().length > 0,
          }))
        : [],
    });
  });

  await page.goto(`${BASE_URL}/concierge`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('h1:has-text("Rug Concierge")');
  await page.waitForSelector('textarea');
  return page;
}

async function sendMessage(page, text) {
  const input = page.locator('textarea').first();
  await input.click();
  try { await input.press('Control+A'); } catch {}
  try { await input.press('Meta+A'); } catch {}
  await input.press('Backspace');
  await input.type(text, { delay: 8 });

  const sendButton = page.getByRole('button', { name: 'Send' });
  const responsePromise = page.waitForResponse(
    (res) => res.url().includes('/api/chat') && res.request().method() === 'POST',
    { timeout: 45000 }
  );
  await sendButton.click();
  await responsePromise;
  await page.waitForTimeout(900);
}

async function collectUiStats(page) {
  return page.evaluate(() => {
    const recommendationCards = Array.from(document.querySelectorAll('h3')).filter((el) =>
      (el.textContent || '').trim().length > 0
    ).length;
    const noImagePlaceholders = document.querySelectorAll('[aria-label="No rug image"]').length;
    const rugImages = Array.from(document.querySelectorAll('img')).filter((img) => {
      const alt = (img.getAttribute('alt') || '').toLowerCase();
      return alt.includes('rug');
    }).length;
    const moreDetailsButtons = Array.from(document.querySelectorAll('summary')).filter((el) =>
      (el.textContent || '').toLowerCase().includes('more details')
    ).length;

    return {
      recommendationCards,
      noImagePlaceholders,
      rugImages,
      moreDetailsButtons,
    };
  });
}

async function captureDesktopScenario(browserLabel, browserType, captureLog) {
  const context = await browserType.newContext({ viewport: { width: 1440, height: 1180 } });
  await setRoleCookies(context);

  const page = await openConcierge(context, browserLabel, 'desktop', captureLog);

  await page.screenshot({ path: path.join(OUT_DIR, `${browserLabel}-desktop-empty.png`) });

  await sendMessage(page, 'I need an 8x10 rug under $2500 for a warm neutral living room.');
  await page.screenshot({ path: path.join(OUT_DIR, `${browserLabel}-desktop-after-turn-1.png`) });

  await sendMessage(page, 'Show me three options to compare with images.');
  await page.screenshot({ path: path.join(OUT_DIR, `${browserLabel}-desktop-recommendations.png`) });

  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'auto' }));
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT_DIR, `${browserLabel}-desktop-scroll-top.png`) });

  const stats = await collectUiStats(page);
  await context.close();
  return { browser: browserLabel, viewport: 'desktop', ...stats };
}

async function captureMobileScenario(browserLabel, browserType, captureLog) {
  const context = await browserType.newContext({ viewport: { width: 390, height: 844 } });
  await setRoleCookies(context);

  const page = await openConcierge(context, browserLabel, 'mobile', captureLog);

  await page.screenshot({ path: path.join(OUT_DIR, `${browserLabel}-mobile-empty.png`) });

  await sendMessage(page, 'I need an 8x10 rug under $2500 for a warm neutral living room.');
  await sendMessage(page, 'Show me three options to compare with images.');

  await page.screenshot({ path: path.join(OUT_DIR, `${browserLabel}-mobile-recommendations-top.png`) });

  const noImage = page.locator('[aria-label="No rug image"]').first();
  if ((await noImage.count()) > 0) {
    await noImage.scrollIntoViewIfNeeded();
  } else {
    const firstCardTitle = page.locator('h3').first();
    if ((await firstCardTitle.count()) > 0) {
      await firstCardTitle.scrollIntoViewIfNeeded();
    }
  }
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT_DIR, `${browserLabel}-mobile-recommendations-cards.png`) });

  const stats = await collectUiStats(page);
  await context.close();
  return { browser: browserLabel, viewport: 'mobile', ...stats };
}

async function runBrowser(browserLabel, launcher) {
  const browser = await launcher.launch({ headless: true });
  const captureLog = [];
  try {
    const desktopStats = await captureDesktopScenario(browserLabel, browser, captureLog);
    const mobileStats = await captureMobileScenario(browserLabel, browser, captureLog);
    return { desktopStats, mobileStats, captureLog };
  } finally {
    await browser.close();
  }
}

function summarizeLogs(allLogs) {
  const recommendationEntries = allLogs.filter((entry) => entry.recommendationCount > 0);
  const totalRecommendations = recommendationEntries.reduce(
    (sum, entry) => sum + entry.recommendationCount,
    0
  );
  const withImages = recommendationEntries.reduce(
    (sum, entry) => sum + entry.recommendations.filter((item) => item.hasImage).length,
    0
  );
  const withoutImages = totalRecommendations - withImages;

  return {
    totalChatResponses: allLogs.length,
    recommendationResponses: recommendationEntries.length,
    totalRecommendations,
    recommendationsWithImages: withImages,
    recommendationsWithoutImages: withoutImages,
  };
}

(async () => {
  ensureOutDir();

  const chromiumResult = await runBrowser('chromium', chromium);
  const webkitResult = await runBrowser('webkit', webkit);

  const logs = [...chromiumResult.captureLog, ...webkitResult.captureLog];
  const uiStats = [
    chromiumResult.desktopStats,
    chromiumResult.mobileStats,
    webkitResult.desktopStats,
    webkitResult.mobileStats,
  ];
  const summary = summarizeLogs(logs);

  fs.writeFileSync(
    path.join(OUT_DIR, 'chat-response-log.json'),
    JSON.stringify(logs, null, 2)
  );
  fs.writeFileSync(
    path.join(OUT_DIR, 'ui-stats.json'),
    JSON.stringify(uiStats, null, 2)
  );
  fs.writeFileSync(
    path.join(OUT_DIR, 'summary.json'),
    JSON.stringify(summary, null, 2)
  );

  console.log('Saved screenshots and analysis artifacts to', OUT_DIR);
  console.log(JSON.stringify(summary, null, 2));
})();
