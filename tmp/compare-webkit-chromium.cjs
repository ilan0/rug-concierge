const { chromium, webkit } = require('playwright');

const BASE_URL = 'http://127.0.0.1:3000';

async function capture(browserType, output) {
  const browser = await browserType.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1024 } });
  await context.addCookies([
    { name: 'rug_ui_role', value: 'retail_customer', url: `${BASE_URL}/`, sameSite: 'Lax' },
    { name: 'rug_ui_tenant_id', value: 'demo-tenant', url: `${BASE_URL}/`, sameSite: 'Lax' },
  ]);
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/concierge`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('h1:has-text("Rug Concierge")', { timeout: 20000 });
  await page.waitForTimeout(700);
  await page.screenshot({ path: output, fullPage: false });
  await browser.close();
}

(async () => {
  await capture(chromium, 'tmp/concierge-chromium-empty.png');
  await capture(webkit, 'tmp/concierge-webkit-empty.png');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
