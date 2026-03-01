const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 980 } });

  const base = 'http://localhost:3010';
  await context.addCookies([
    { name: 'rug_ui_role', value: 'retail_customer', url: base, path: '/' },
    { name: 'rug_ui_tenant_id', value: 'demo-tenant', url: base, path: '/' },
    { name: 'rug_pilot_access', value: '1', url: base, path: '/' },
  ]);

  const page = await context.newPage();

  let apiTurn = 0;
  await page.route('**/api/chat', async (route) => {
    apiTurn += 1;
    const request = route.request();
    const body = JSON.parse(request.postData() || '{}');
    const userMessage = typeof body.message === 'string' ? body.message : '';

    const payload = apiTurn === 1
      ? {
          session_id: 'mock-session-1',
          role: body.role || 'retail_customer',
          mode: 'general_chat',
          fine_mode: 'general_chat',
          recommendation_state: {
            hard_constraints: {},
            soft_preferences: {},
          },
          response: {
            mode: 'general_chat',
            assistant_message: `Great start. You asked: ${userMessage}. What room is this for?`,
            notes: null,
            follow_up_question: 'What size are you considering?'
          }
        }
      : {
          session_id: 'mock-session-1',
          role: body.role || 'retail_customer',
          mode: 'recommendation',
          fine_mode: 'recommendation',
          recommendation_state: {
            hard_constraints: {
              size: { widthIn: 96, lengthIn: 120 },
              budgetMax: 2500,
            },
            soft_preferences: {
              style: 'Modern neutral',
              palette: 'Warm sand and ivory',
            },
          },
          response: {
            mode: 'recommendation',
            assistant_message: 'Here are curated options that fit your space and budget.',
            questions: [],
            recommendations: [
              {
                rug_id: 'rug-1',
                sku: 'RC-001',
                title: 'Sandstone Loomed Wool Rug',
                primary_image_url: 'https://images.unsplash.com/photo-1484101403633-562f891dc89a?w=1200',
                primary_image_caption: 'Sandstone rug in bright room',
                size_text: '8 x 10',
                price_usd: 2200,
                match_reasons: ['Balanced neutral palette', 'Soft underfoot', 'Fits 8x10 target'],
                confidence: 0.87,
                confidence_tier: 'high',
                confidence_factors: ['size match', 'style match'],
                why_not: ['Slightly above lower budget ranges'],
              },
              {
                rug_id: 'rug-2',
                sku: 'RC-014',
                title: 'Ivory Heritage Hand-Knotted Rug',
                primary_image_url: 'https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?w=1200',
                primary_image_caption: 'Ivory rug with seating area',
                size_text: '8 x 10',
                price_usd: 2450,
                match_reasons: ['Elegant traditional-modern blend', 'High durability'],
                confidence: 0.82,
                confidence_tier: 'high',
                confidence_factors: ['style', 'durability'],
                why_not: [],
              }
            ],
            notes: null,
          }
        };

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'x-chat-route-trace-id': 'mock-trace' },
      body: JSON.stringify(payload),
    });
  });

  await page.goto(`${base}/concierge`, { waitUntil: 'networkidle' });
  await page.waitForSelector('h1:has-text("Rug Concierge")');

  await page.screenshot({
    path: '/Users/ilannabatkhorian/Documents/rug-concierge/tmp/concierge-empty.png',
    fullPage: true,
  });

  const input = page.getByPlaceholder('Describe what you’re looking for…');
  await input.fill('I need an 8x10 rug for a warm modern living room under $2500.');
  await page.getByRole('button', { name: 'Send' }).click();
  await page.waitForTimeout(500);
  await page.waitForSelector('text=What room is this for?', { timeout: 10000 });

  await input.fill('Show curated options with softer textures and neutral tones.');
  await page.getByRole('button', { name: 'Send' }).click();
  await page.waitForSelector('text=Here are curated options that fit your space and budget.', { timeout: 10000 });
  await page.waitForTimeout(600);

  await page.screenshot({
    path: '/Users/ilannabatkhorian/Documents/rug-concierge/tmp/concierge-after-two-turns.png',
    fullPage: true,
  });

  await browser.close();
})();
