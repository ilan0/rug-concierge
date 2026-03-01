const { chromium, webkit } = require('playwright');

const BASE_URL = 'http://127.0.0.1:3000';

function buildRecommendationResponse(role) {
  return {
    session_id: 'session-grid-001',
    role,
    mode: 'recommendation',
    fine_mode: 'recommendation',
    recommendation_state: {
      hard_constraints: {
        size: {
          widthIn: 96,
          lengthIn: 120,
          toleranceIn: 4,
        },
        budgetMax: 2800,
      },
      soft_preferences: {
        style: 'Modern neutral',
        palette: 'Warm beige',
      },
    },
    response: {
      mode: 'recommendation',
      assistant_message:
        'Excellent. Here are three curated picks with clear tradeoffs so you can compare quickly.',
      questions: [],
      recommendations: [
        {
          rug_id: 'rug-001',
          sku: 'RS-1001',
          title: 'Willow Sands',
          primary_image_url: null,
          primary_image_caption: null,
          size_text: '8 x 10',
          price_usd: 2195,
          match_reasons: [
            'Warm neutral palette',
            'Soft texture for living rooms',
            'Balanced pattern scale',
            'Easy to pair with wood tones',
          ],
          confidence: 0.88,
          confidence_tier: 'high',
          confidence_factors: ['size match', 'budget fit'],
          why_not: ['Less contrast than bold geometric rugs'],
        },
        {
          rug_id: 'rug-002',
          sku: 'RS-1002',
          title: 'Dune Weave',
          primary_image_url: null,
          primary_image_caption: null,
          size_text: '8 x 10',
          price_usd: 2390,
          match_reasons: [
            'Natural fiber look',
            'Easy to layer with warm neutrals',
            'Subtle texture depth',
          ],
          confidence: 0.84,
          confidence_tier: 'high',
          confidence_factors: ['style fit'],
          why_not: ['Slightly firmer underfoot'],
        },
        {
          rug_id: 'rug-003',
          sku: 'RS-1003',
          title: 'Harbor Loom',
          primary_image_url: null,
          primary_image_caption: null,
          size_text: '8 x 10',
          price_usd: 2590,
          match_reasons: [
            'Higher pile comfort',
            'Softens echo in open layouts',
            'Muted linear detailing',
          ],
          confidence: 0.8,
          confidence_tier: 'medium',
          confidence_factors: ['comfort'],
          why_not: ['Heavier visual weight in small rooms'],
        },
      ],
      notes: null,
    },
  };
}

function buildGeneralResponse(role, message) {
  return {
    session_id: 'session-grid-001',
    role,
    mode: 'general_chat',
    fine_mode: 'general_chat',
    response: {
      mode: 'general_chat',
      assistant_message: `Great direction. For "${message}", do you prefer soft vintage neutrals or a cleaner modern look?`,
      notes: null,
      follow_up_question: null,
    },
  };
}

async function setupPage(context, browserName, viewportName) {
  await context.addCookies([
    { name: 'rug_ui_role', value: 'retail_customer', url: `${BASE_URL}/`, sameSite: 'Lax' },
    { name: 'rug_ui_tenant_id', value: 'demo-tenant', url: `${BASE_URL}/`, sameSite: 'Lax' },
  ]);

  const page = await context.newPage();
  let callCount = 0;

  await page.route('**/api/chat', async (route) => {
    callCount += 1;
    const body = route.request().postDataJSON() || {};
    const role = typeof body.role === 'string' ? body.role : 'retail_customer';
    const message = typeof body.message === 'string' ? body.message : 'your room details';
    const payload = callCount >= 2 ? buildRecommendationResponse(role) : buildGeneralResponse(role, message);

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'x-chat-route-trace-id': `${browserName}-${viewportName}-${callCount}` },
      body: JSON.stringify(payload),
    });
  });

  await page.goto(`${BASE_URL}/concierge`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('h1:has-text("Rug Concierge")', { timeout: 20000 });
  await page.waitForSelector('text=Tell me what kind of rug', { timeout: 20000 });

  return page;
}

async function setComposerMessage(page, text) {
  const textarea = page.locator('textarea').first();
  await textarea.click();
  try {
    await textarea.press('Control+A');
  } catch {}
  try {
    await textarea.press('Meta+A');
  } catch {}
  await textarea.press('Backspace');
  await textarea.type(text, { delay: 4 });
}

async function createRecommendationTurn(page) {
  await setComposerMessage(page, 'Show me what you have');
  await page.getByRole('button', { name: 'Send' }).click();
  await page.waitForSelector('text=Great direction.', { timeout: 20000 });

  await setComposerMessage(page, 'Show me 8x10 options under $2800 with warm neutrals');
  await page.getByRole('button', { name: 'Send' }).click();
  await page.waitForSelector('text=Willow Sands', { timeout: 20000 });
  await page.waitForTimeout(700);
}

async function captureSet(browserName, launcher) {
  const browser = await launcher.launch({ headless: true });
  try {
    // Desktop empty (control)
    {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1024 } });
      const page = await setupPage(context, browserName, 'desktop-empty');
      await page.waitForTimeout(600);
      await page.screenshot({ path: `tmp/${browserName}-grid-desktop-empty.png` });
      await context.close();
    }

    // Desktop recommendation (3 cols)
    {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1150 } });
      const page = await setupPage(context, browserName, 'desktop-reco');
      await createRecommendationTurn(page);
      await page.screenshot({ path: `tmp/${browserName}-grid-desktop-recommendation.png` });
      await context.close();
    }

    // Tablet recommendation (2 cols)
    {
      const context = await browser.newContext({ viewport: { width: 1024, height: 1180 } });
      const page = await setupPage(context, browserName, 'tablet-reco');
      await createRecommendationTurn(page);
      await page.screenshot({ path: `tmp/${browserName}-grid-tablet-recommendation.png` });
      await context.close();
    }

    // Mobile recommendation (1 col)
    {
      const context = await browser.newContext({ viewport: { width: 390, height: 1200 } });
      const page = await setupPage(context, browserName, 'mobile-reco');
      await createRecommendationTurn(page);
      await page.screenshot({ path: `tmp/${browserName}-grid-mobile-recommendation.png` });
      await context.close();
    }

    // Mobile recommendation expanded details
    {
      const context = await browser.newContext({ viewport: { width: 390, height: 1200 } });
      const page = await setupPage(context, browserName, 'mobile-expanded');
      await createRecommendationTurn(page);
      const summary = page.locator('summary', { hasText: 'More details' }).first();
      await summary.scrollIntoViewIfNeeded();
      await summary.click();
      await page.waitForTimeout(250);
      await page.screenshot({ path: `tmp/${browserName}-grid-mobile-expanded.png` });
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

(async () => {
  await captureSet('chromium', chromium);
  await captureSet('webkit', webkit);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
