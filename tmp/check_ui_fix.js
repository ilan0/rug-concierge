const { chromium } = require('/Users/ilannabatkhorian/Documents/rug-concierge/node_modules/playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1366, height: 1024 } });
  const page = await context.newPage();

  await page.goto('https://jjrugs.rugdesk.app/concierge?v=' + Date.now(), { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Tap to Start/i }).click();
  await page.waitForTimeout(1200);

  const input = page.getByPlaceholder(/Describe what you're looking for/i);
  await input.fill('show me rugs for my living room');
  await page.keyboard.press('Enter');
  await page.waitForSelector('[data-recommendation-card="true"]', { timeout: 35000 });

  await page.screenshot({ path: '/Users/ilannabatkhorian/Documents/rug-concierge/tmp/verify-postfix-active.png', fullPage: true });

  const firstCard = page.locator('[data-recommendation-card="true"]').first();
  await firstCard.click();
  await page.waitForSelector('[role="dialog"]', { timeout: 15000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: '/Users/ilannabatkhorian/Documents/rug-concierge/tmp/verify-postfix-modal.png', fullPage: true });

  const styles = await page.evaluate(() => {
    const modal = document.querySelector('[role="dialog"]');
    const composer = document.querySelector('[data-concierge-composer="true"] > div > div');
    const userBubble = Array.from(document.querySelectorAll('article')).find((el) => (el.textContent || '').includes('show me rugs for my living room'));

    const read = (el) => {
      if (el === null || el === undefined) return null;
      const cs = window.getComputedStyle(el);
      return {
        backgroundColor: cs.backgroundColor,
        borderColor: cs.borderColor,
        boxShadow: cs.boxShadow,
        backdropFilter: cs.backdropFilter,
      };
    };

    return {
      modal: read(modal),
      composer: read(composer),
      userBubble: read(userBubble),
    };
  });

  console.log(JSON.stringify(styles, null, 2));
  await browser.close();
})();
