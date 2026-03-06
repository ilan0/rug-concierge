const fs = require('fs');
const path = require('path');
const { chromium, webkit } = require('playwright');

const BASE_URL = 'http://127.0.0.1:3000';
const OUT_DIR = path.join('tmp', 'ui-full-audit');
const TENANT_ID = '0a175457-6194-4ae9-bf4e-1a785d754c4b';

const STORAGE_KEYS = {
  role: 'rug_concierge_ui_role',
  tenant: 'rug_concierge_tenant_id',
};

const ROUTES = [
  { key: 'home', path: '/', role: 'store_staff', waitFor: 'text=MVP Workspace' },
  { key: 'concierge', path: '/concierge', role: 'retail_customer', waitFor: 'h1:has-text("Rug Concierge")' },
  { key: 'trade', path: '/trade', role: 'trade_client', waitFor: 'text=Trade Support' },
  { key: 'inventory', path: '/inventory', role: 'store_staff', waitFor: 'text=Inventory Browser' },
  { key: 'appraisal', path: '/appraisal', role: 'store_staff', waitFor: 'text=Appraisal Studio' },
];

const VIEWPORTS = [
  { key: 'desktop', viewport: { width: 1440, height: 1100 } },
  { key: 'mobile', viewport: { width: 390, height: 844 } },
];

async function createContext(browser, role, viewport) {
  const context = await browser.newContext({ viewport });
  await context.addCookies([
    { name: 'rug_ui_role', value: role, url: `${BASE_URL}/`, sameSite: 'Lax' },
    { name: 'rug_ui_tenant_id', value: TENANT_ID, url: `${BASE_URL}/`, sameSite: 'Lax' },
  ]);
  await context.addInitScript(
    ({ roleValue, tenantValue, roleKey, tenantKey }) => {
      window.localStorage.setItem(roleKey, roleValue);
      window.localStorage.setItem(tenantKey, tenantValue);
    },
    {
      roleValue: role,
      tenantValue: TENANT_ID,
      roleKey: STORAGE_KEYS.role,
      tenantKey: STORAGE_KEYS.tenant,
    }
  );
  return context;
}

async function captureRoute(browser, browserKey, route, viewportDef) {
  const context = await createContext(browser, route.role, viewportDef.viewport);
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(45000);
    await page.goto(`${BASE_URL}${route.path}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector(route.waitFor, { timeout: 45000 });
    await page.waitForTimeout(900);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'auto' }));
    await page.waitForTimeout(120);

    const baseName = `${browserKey}-${viewportDef.key}-${route.key}`;
    const topPath = path.join(OUT_DIR, `${baseName}-top.png`);
    await page.screenshot({ path: topPath });

    const scrollPath = path.join(OUT_DIR, `${baseName}-scroll.png`);
    await page.evaluate(() => window.scrollTo({ top: Math.floor(window.innerHeight * 0.95), behavior: 'auto' }));
    await page.waitForTimeout(350);
    await page.screenshot({ path: scrollPath });

    return {
      browser: browserKey,
      viewport: viewportDef.key,
      route: route.key,
      topPath,
      scrollPath,
    };
  } finally {
    await context.close();
  }
}

async function runForBrowser(browserKey, launcher) {
  const browser = await launcher.launch({ headless: true });
  const results = [];
  try {
    for (const viewportDef of VIEWPORTS) {
      for (const route of ROUTES) {
        const shot = await captureRoute(browser, browserKey, route, viewportDef);
        results.push(shot);
      }
    }
  } finally {
    await browser.close();
  }
  return results;
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const chromiumResults = await runForBrowser('chromium', chromium);
  const webkitResults = await runForBrowser('webkit', webkit);
  const all = [...chromiumResults, ...webkitResults];
  fs.writeFileSync(path.join(OUT_DIR, 'shots.json'), JSON.stringify(all, null, 2));
  console.log(`Saved ${all.length * 2} screenshots to ${OUT_DIR}`);
})();
