const { chromium } = require('playwright');

const BASE_URL = 'http://127.0.0.1:3000';

async function run() {
  console.log('launch');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1024 } });

  await context.addCookies([
    {
      name: 'rug_ui_role',
      value: 'retail_customer',
      url: `${BASE_URL}/`,
      sameSite: 'Lax',
    },
    {
      name: 'rug_ui_tenant_id',
      value: 'demo-tenant',
      url: `${BASE_URL}/`,
      sameSite: 'Lax',
    },
  ]);

  const page = await context.newPage();
  page.setDefaultTimeout(15000);

  await page.route('**/api/chat', async (route) => {
    const body = route.request().postDataJSON() || {};
    const role = typeof body.role === 'string' ? body.role : 'retail_customer';
    const message = typeof body.message === 'string' ? body.message : 'your room details';

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: {
        'x-chat-route-trace-id': 'screenshot-capture-trace',
      },
      body: JSON.stringify({
        session_id: 'session-screenshot-001',
        role,
        mode: 'general_chat',
        fine_mode: 'general_chat',
        response: {
          mode: 'general_chat',
          assistant_message: `Great direction. For “${message},” do you prefer soft vintage neutrals or higher-contrast geometric patterns?`,
          notes: null,
          follow_up_question: null,
        },
      }),
    });
  });

  console.log('goto');
  await page.goto(`${BASE_URL}/concierge`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('h1:has-text("Rug Concierge")', { timeout: 15000 });
  await page.waitForSelector('text=Tell me what kind of rug', { timeout: 15000 });
  console.log('empty state visible');

  await page.screenshot({ path: 'tmp/concierge-empty-state.png' });
  console.log('saved empty');

  const firstPromptButton = page.locator('article button').first();
  await firstPromptButton.click();
  console.log('clicked first chip');
  await page.getByRole('button', { name: 'Send' }).click();
  console.log('clicked send');

  await page.waitForSelector('text=Great direction.');
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'tmp/concierge-two-turns.png' });
  console.log('saved two turns');

  await browser.close();
  console.log('closed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
