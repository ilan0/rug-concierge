const fs = require('fs');
const path = require('path');
const { chromium, webkit } = require('playwright');

const BASE_URL = 'http://127.0.0.1:3000';
const OUT_DIR = path.join('tmp', 'concierge-real-audit');
const TENANT_ID = '0a175457-6194-4ae9-bf4e-1a785d754c4b';
const PROMPT = 'Show colorful traditional options with images';

async function attachCookies(context) {
  await context.addCookies([
    { name: 'rug_ui_role', value: 'retail_customer', url: `${BASE_URL}/`, sameSite: 'Lax' },
    { name: 'rug_ui_tenant_id', value: TENANT_ID, url: `${BASE_URL}/`, sameSite: 'Lax' },
  ]);
}

async function runOne(browserLabel, launcher, viewportName, viewport) {
  const browser = await launcher.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport });
    await attachCookies(context);
    const page = await context.newPage();
    await page.goto(`${BASE_URL}/concierge`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('textarea');

    const input = page.locator('textarea').first();
    await input.fill(PROMPT);

    const responsePromise = page.waitForResponse(
      (res) => res.url().includes('/api/chat') && res.request().method() === 'POST',
      { timeout: 60000 }
    );
    await page.getByRole('button', { name: 'Send' }).click();
    await responsePromise;

    await page.waitForSelector('h3', { timeout: 30000 });

    await page.waitForFunction(() => {
      const imgs = Array.from(document.querySelectorAll('img'));
      if (imgs.length === 0) return false;
      return imgs.every((img) => img.complete && img.naturalWidth > 0);
    }, { timeout: 30000 }).catch(() => null);

    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(OUT_DIR, `${browserLabel}-${viewportName}-recommendation-vivid.png`) });

    await context.close();
  } finally {
    await browser.close();
  }
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  await runOne('chromium', chromium, 'desktop', { width: 1440, height: 1100 });
  await runOne('webkit', webkit, 'desktop', { width: 1440, height: 1100 });
  await runOne('chromium', chromium, 'mobile', { width: 390, height: 844 });
  await runOne('webkit', webkit, 'mobile', { width: 390, height: 844 });
  console.log('saved vivid captures');
})();
