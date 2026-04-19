import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
for (const [name, width, height] of [['desktop', 1440, 1200], ['tablet', 900, 1200], ['mobile', 390, 844]]) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
  await page.screenshot({ path: `tmp/site-qa/${name}.png`, fullPage: true });
  await page.close();
}
await browser.close();
