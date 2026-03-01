const fs = require('fs');
const path = require('path');
const { chromium, webkit } = require('playwright');

const BASE_URL = 'http://127.0.0.1:3000';
const OUT_DIR = path.join('tmp', 'concierge-real-audit');

function ensureOutDir() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

function loadEnvLocal() {
  const envPath = path.join('apps', 'web', '.env.local');
  const raw = fs.readFileSync(envPath, 'utf8');
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx < 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    env[key] = value;
  }
  return env;
}

async function fetchSupabaseRows(url, secret, resource) {
  const res = await fetch(`${url}/rest/v1/${resource}`, {
    headers: {
      apikey: secret,
      Authorization: `Bearer ${secret}`,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase query failed (${resource}): ${res.status} ${text}`);
  }
  return res.json();
}

async function resolveTenantIdAndCoverage() {
  const env = loadEnvLocal();
  const supabaseUrl = env.SUPABASE_URL;
  const supabaseSecret = env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !supabaseSecret) {
    throw new Error('SUPABASE_URL or SUPABASE_SECRET_KEY missing from apps/web/.env.local');
  }

  const rugs = await fetchSupabaseRows(
    supabaseUrl,
    supabaseSecret,
    'rugs?select=tenant_id,id&limit=10000'
  );
  const images = await fetchSupabaseRows(
    supabaseUrl,
    supabaseSecret,
    'rug_images?select=tenant_id,rug_id,path&limit=10000'
  );

  const imageByTenant = new Map();
  for (const row of images) {
    if (!row || typeof row.tenant_id !== 'string' || typeof row.rug_id !== 'string') continue;
    if (typeof row.path !== 'string' || row.path.trim().length === 0) continue;
    if (!imageByTenant.has(row.tenant_id)) imageByTenant.set(row.tenant_id, new Set());
    imageByTenant.get(row.tenant_id).add(row.rug_id);
  }

  const rugsByTenant = new Map();
  for (const row of rugs) {
    if (!row || typeof row.tenant_id !== 'string' || typeof row.id !== 'string') continue;
    if (!rugsByTenant.has(row.tenant_id)) rugsByTenant.set(row.tenant_id, []);
    rugsByTenant.get(row.tenant_id).push(row.id);
  }

  const coverage = [];
  for (const [tenantId, rugIds] of rugsByTenant.entries()) {
    const imageSet = imageByTenant.get(tenantId) || new Set();
    let withImage = 0;
    for (const rugId of rugIds) {
      if (imageSet.has(rugId)) withImage += 1;
    }
    coverage.push({
      tenant_id: tenantId,
      total_rugs: rugIds.length,
      rugs_with_image_path: withImage,
      rugs_missing_image_path: rugIds.length - withImage,
      coverage_ratio: rugIds.length > 0 ? Number((withImage / rugIds.length).toFixed(4)) : 0,
    });
  }

  coverage.sort((a, b) => {
    if (b.coverage_ratio !== a.coverage_ratio) return b.coverage_ratio - a.coverage_ratio;
    return b.total_rugs - a.total_rugs;
  });

  const chosenTenant = coverage.find((row) => row.total_rugs > 0 && row.rugs_with_image_path > 0);
  if (!chosenTenant) {
    throw new Error('No tenant with rugs + image paths found in Supabase data.');
  }

  return {
    tenantId: chosenTenant.tenant_id,
    coverage,
  };
}

async function attachCookies(context, tenantId, role = 'retail_customer') {
  await context.addCookies([
    { name: 'rug_ui_role', value: role, url: `${BASE_URL}/`, sameSite: 'Lax' },
    { name: 'rug_ui_tenant_id', value: tenantId, url: `${BASE_URL}/`, sameSite: 'Lax' },
  ]);
}

async function openPage(context, captureLog, meta) {
  const page = await context.newPage();
  page.setDefaultTimeout(45000);

  page.on('response', async (response) => {
    if (!response.url().includes('/api/chat') || response.request().method() !== 'POST') return;
    let requestBody = null;
    let responseBody = null;
    try { requestBody = response.request().postDataJSON(); } catch {}
    try { responseBody = await response.json(); } catch {}

    const recommendations = responseBody?.response?.recommendations;
    const recArray = Array.isArray(recommendations) ? recommendations : [];
    captureLog.push({
      ...meta,
      type: 'chat_response',
      status: response.status(),
      message: requestBody?.message ?? null,
      mode: responseBody?.mode ?? null,
      fine_mode: responseBody?.fine_mode ?? null,
      response_mode: responseBody?.response?.mode ?? null,
      notes: responseBody?.response?.notes ?? null,
      assistant_message: responseBody?.response?.assistant_message ?? null,
      recommendation_count: recArray.length,
      recommendation_images: recArray.map((item) => ({
        rug_id: item?.rug_id ?? null,
        title: item?.title ?? null,
        has_image_url:
          typeof item?.primary_image_url === 'string' && item.primary_image_url.trim().length > 0,
      })),
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

  const responsePromise = page.waitForResponse(
    (res) => res.url().includes('/api/chat') && res.request().method() === 'POST',
    { timeout: 60000 }
  );
  await page.getByRole('button', { name: 'Send' }).click();
  await responsePromise;
  await page.waitForTimeout(900);
}

async function collectUiStats(page) {
  return page.evaluate(() => {
    const noRugImagePlaceholders = document.querySelectorAll('[aria-label="No rug image"]').length;
    const recommendationCards = Array.from(document.querySelectorAll('h3')).length;
    const whyThisFitsHeadings = Array.from(document.querySelectorAll('p')).filter((p) =>
      (p.textContent || '').trim().toLowerCase() === 'why this fits'
    ).length;
    const jumpButtons = Array.from(document.querySelectorAll('button')).filter((btn) =>
      (btn.textContent || '').trim().toLowerCase() === 'jump to latest'
    ).length;
    return {
      noRugImagePlaceholders,
      recommendationCards,
      whyThisFitsHeadings,
      jumpButtons,
    };
  });
}

async function captureProfile(browserLabel, launcher, viewportName, viewport, tenantId, isDesktop) {
  const browser = await launcher.launch({ headless: true });
  const captureLog = [];
  const stats = [];

  try {
    // Empty state
    {
      const context = await browser.newContext({ viewport });
      await attachCookies(context, tenantId);
      const page = await openPage(context, captureLog, {
        browser: browserLabel,
        viewport: viewportName,
        scenario: 'empty',
      });
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(OUT_DIR, `${browserLabel}-${viewportName}-empty.png`) });
      stats.push({
        browser: browserLabel,
        viewport: viewportName,
        scenario: 'empty',
        ...(await collectUiStats(page)),
      });
      await context.close();
    }

    // Recommendation success scenario
    {
      const context = await browser.newContext({ viewport });
      await attachCookies(context, tenantId);
      const page = await openPage(context, captureLog, {
        browser: browserLabel,
        viewport: viewportName,
        scenario: 'recommendation',
      });

      await sendMessage(page, 'Show available rugs from inventory with images.');
      await page.screenshot({ path: path.join(OUT_DIR, `${browserLabel}-${viewportName}-recommendation.png`) });

      if (isDesktop) {
        await sendMessage(page, 'Show 3 more options and keep image-rich picks.');
        await page.screenshot({ path: path.join(OUT_DIR, `${browserLabel}-${viewportName}-recommendation-followup.png`) });
      }

      stats.push({
        browser: browserLabel,
        viewport: viewportName,
        scenario: 'recommendation',
        ...(await collectUiStats(page)),
      });

      await context.close();
    }

    // No-match strict constraint scenario
    {
      const context = await browser.newContext({ viewport });
      await attachCookies(context, tenantId);
      const page = await openPage(context, captureLog, {
        browser: browserLabel,
        viewport: viewportName,
        scenario: 'strict_no_match',
      });

      await sendMessage(page, 'I need a 14x20 rug under $600 with hand-knotted vintage Persian style.');
      await page.screenshot({ path: path.join(OUT_DIR, `${browserLabel}-${viewportName}-strict-no-match.png`) });

      stats.push({
        browser: browserLabel,
        viewport: viewportName,
        scenario: 'strict_no_match',
        ...(await collectUiStats(page)),
      });

      await context.close();
    }
  } finally {
    await browser.close();
  }

  return { captureLog, stats };
}

function summarizeChatLogs(logs) {
  const recommendationResponses = logs.filter((entry) => entry.recommendation_count > 0);
  const recItems = recommendationResponses.flatMap((entry) => entry.recommendation_images || []);
  const recWithImage = recItems.filter((item) => item.has_image_url).length;
  const recWithoutImage = recItems.length - recWithImage;

  const byScenario = {};
  for (const entry of logs) {
    const key = `${entry.browser}:${entry.viewport}:${entry.scenario}`;
    if (!byScenario[key]) {
      byScenario[key] = {
        chat_responses: 0,
        recommendation_responses: 0,
        total_recommendations: 0,
        recommendations_with_image_url: 0,
        recommendations_without_image_url: 0,
      };
    }
    const bucket = byScenario[key];
    bucket.chat_responses += 1;
    if (entry.recommendation_count > 0) {
      bucket.recommendation_responses += 1;
      bucket.total_recommendations += entry.recommendation_count;
      const withImage = (entry.recommendation_images || []).filter((item) => item.has_image_url).length;
      bucket.recommendations_with_image_url += withImage;
      bucket.recommendations_without_image_url += entry.recommendation_count - withImage;
    }
  }

  return {
    total_chat_responses: logs.length,
    recommendation_responses: recommendationResponses.length,
    total_recommendations: recItems.length,
    recommendations_with_image_url: recWithImage,
    recommendations_without_image_url: recWithoutImage,
    by_scenario: byScenario,
  };
}

(async () => {
  ensureOutDir();

  const { tenantId, coverage } = await resolveTenantIdAndCoverage();

  const chromiumDesktop = await captureProfile(
    'chromium',
    chromium,
    'desktop',
    { width: 1440, height: 1100 },
    tenantId,
    true
  );
  const webkitDesktop = await captureProfile(
    'webkit',
    webkit,
    'desktop',
    { width: 1440, height: 1100 },
    tenantId,
    true
  );
  const chromiumMobile = await captureProfile(
    'chromium',
    chromium,
    'mobile',
    { width: 390, height: 844 },
    tenantId,
    false
  );
  const webkitMobile = await captureProfile(
    'webkit',
    webkit,
    'mobile',
    { width: 390, height: 844 },
    tenantId,
    false
  );

  const logs = [
    ...chromiumDesktop.captureLog,
    ...webkitDesktop.captureLog,
    ...chromiumMobile.captureLog,
    ...webkitMobile.captureLog,
  ];
  const uiStats = [
    ...chromiumDesktop.stats,
    ...webkitDesktop.stats,
    ...chromiumMobile.stats,
    ...webkitMobile.stats,
  ];

  const chatSummary = summarizeChatLogs(logs);

  const report = {
    executed_at: new Date().toISOString(),
    base_url: BASE_URL,
    tenant_id_used_for_capture: tenantId,
    db_image_coverage_by_tenant: coverage,
    chat_image_summary: chatSummary,
    ui_stats: uiStats,
    screenshots: fs
      .readdirSync(OUT_DIR)
      .filter((name) => name.endsWith('.png'))
      .sort(),
  };

  fs.writeFileSync(path.join(OUT_DIR, 'chat-response-log.json'), JSON.stringify(logs, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, 'report.json'), JSON.stringify(report, null, 2));

  console.log('Saved real audit artifacts to', OUT_DIR);
  console.log(JSON.stringify({
    tenant_id_used_for_capture: tenantId,
    recommendation_responses: chatSummary.recommendation_responses,
    total_recommendations: chatSummary.total_recommendations,
    recommendations_with_image_url: chatSummary.recommendations_with_image_url,
    recommendations_without_image_url: chatSummary.recommendations_without_image_url,
  }, null, 2));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
