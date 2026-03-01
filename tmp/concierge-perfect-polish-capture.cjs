const { chromium, webkit } = require('playwright');

const BASE_URL = 'http://127.0.0.1:3000';

function chatResponse(callCount, body) {
  const role = typeof body?.role === 'string' ? body.role : 'retail_customer';
  const message = typeof body?.message === 'string' ? body.message : 'your room details';

  if (callCount >= 2) {
    return {
      session_id: 'session-polish-001',
      role,
      mode: 'recommendation',
      fine_mode: 'recommendation',
      recommendation_state: {
        hard_constraints: {
          size: {
            widthIn: 96,
            lengthIn: 120,
            toleranceIn: 6,
          },
          budgetMax: 2500,
        },
        soft_preferences: {
          style: 'Modern neutral',
          palette: 'Warm beige',
        },
      },
      response: {
        mode: 'recommendation',
        assistant_message:
          'Great, I found three strong options that fit your size and budget. Here are the best matches to start with.',
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
            match_reasons: ['Warm neutral palette', 'Soft texture', 'Living-room scale'],
            confidence: 0.86,
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
            match_reasons: ['Natural fiber look', 'Easy to layer tones'],
            confidence: 0.81,
            confidence_tier: 'high',
            confidence_factors: ['style fit'],
            why_not: ['Slightly firmer underfoot'],
          },
        ],
        notes: null,
      },
    };
  }

  return {
    session_id: 'session-polish-001',
    role,
    mode: 'general_chat',
    fine_mode: 'general_chat',
    response: {
      mode: 'general_chat',
      assistant_message: `Great direction. For “${message},” do you prefer soft vintage neutrals or a cleaner modern look?`,
      notes: null,
      follow_up_question: null,
    },
  };
}

async function setupPage(context, outputPrefix, viewportName) {
  await context.addCookies([
    { name: 'rug_ui_role', value: 'retail_customer', url: `${BASE_URL}/`, sameSite: 'Lax' },
    { name: 'rug_ui_tenant_id', value: 'demo-tenant', url: `${BASE_URL}/`, sameSite: 'Lax' },
  ]);

  const page = await context.newPage();
  let callCount = 0;

  await page.route('**/api/chat', async (route) => {
    callCount += 1;
    const body = route.request().postDataJSON() || {};
    const payload = chatResponse(callCount, body);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'x-chat-route-trace-id': `${outputPrefix}-${viewportName}-${callCount}` },
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

async function captureDesktopSet(browserType, browserName) {
  // empty
  {
    const context = await browserType.newContext({ viewport: { width: 1440, height: 1024 } });
    const page = await setupPage(context, browserName, 'desktop');
    await page.waitForTimeout(600);
    await page.screenshot({ path: `tmp/${browserName}-desktop-empty.png` });
    await context.close();
  }

  // two-turn
  {
    const context = await browserType.newContext({ viewport: { width: 1440, height: 1024 } });
    const page = await setupPage(context, browserName, 'desktop');
    await setComposerMessage(page, 'Show me what you have');
    await page.getByRole('button', { name: 'Send' }).click();
    await page.waitForSelector('text=Great direction.', { timeout: 20000 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: `tmp/${browserName}-desktop-two-turn.png` });
    await context.close();
  }

  // recommendation
  {
    const context = await browserType.newContext({ viewport: { width: 1440, height: 1100 } });
    const page = await setupPage(context, browserName, 'desktop');
    await setComposerMessage(page, 'Show me what you have');
    await page.getByRole('button', { name: 'Send' }).click();
    await page.waitForSelector('text=Great direction.', { timeout: 20000 });
    await setComposerMessage(
      page,
      'Show me 8x10 options under $2500 with warm neutrals'
    );
    await page.getByRole('button', { name: 'Send' }).click();
    await page.waitForSelector('text=Willow Sands', { timeout: 20000 });
    await page.waitForTimeout(700);
    await page.screenshot({ path: `tmp/${browserName}-desktop-recommendation.png` });
    await context.close();
  }
}

async function captureMobileSet(browserType, browserName) {
  // empty
  {
    const context = await browserType.newContext({ viewport: { width: 390, height: 844 } });
    const page = await setupPage(context, browserName, 'mobile');
    await page.waitForTimeout(600);
    await page.screenshot({ path: `tmp/${browserName}-mobile-empty.png` });
    await context.close();
  }

  // two-turn
  {
    const context = await browserType.newContext({ viewport: { width: 390, height: 844 } });
    const page = await setupPage(context, browserName, 'mobile');
    await setComposerMessage(page, 'Show me what you have');
    await page.getByRole('button', { name: 'Send' }).click();
    await page.waitForSelector('text=Great direction.', { timeout: 20000 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: `tmp/${browserName}-mobile-two-turn.png` });
    await context.close();
  }
}

async function runFor(browserName, launcher) {
  const browser = await launcher.launch({ headless: true });
  try {
    await captureDesktopSet(browser, browserName);
    await captureMobileSet(browser, browserName);
  } finally {
    await browser.close();
  }
}

(async () => {
  await runFor('chromium', chromium);
  await runFor('webkit', webkit);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
