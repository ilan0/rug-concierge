import { test, expect } from '@playwright/test';

const BASE_URL = 'http://127.0.0.1:3000';

test('capture concierge empty and two-turn states', async ({ page, context }) => {
  await context.addCookies([
    {
      name: 'rug_ui_role',
      value: 'retail_customer',
      url: `${BASE_URL}/`,
      path: '/',
      sameSite: 'Lax',
    },
    {
      name: 'rug_ui_tenant_id',
      value: 'demo-tenant',
      url: `${BASE_URL}/`,
      path: '/',
      sameSite: 'Lax',
    },
  ]);

  await page.route('**/api/chat', async (route) => {
    const body = route.request().postDataJSON() as { role?: string; message?: string };
    const role = typeof body?.role === 'string' ? body.role : 'retail_customer';
    const message = typeof body?.message === 'string' ? body.message : 'your room details';

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

  await page.setViewportSize({ width: 1440, height: 1024 });
  await page.goto(`${BASE_URL}/concierge`, { waitUntil: 'networkidle' });

  await expect(page.getByRole('heading', { name: 'Rug Concierge' })).toBeVisible();
  await expect(page.getByText('Tell me what kind of rug you’re looking for.')).toBeVisible();

  await page.screenshot({
    path: 'tmp/concierge-empty-state.png',
    fullPage: false,
  });

  const firstPrompt = page.locator('article button').first();
  await firstPrompt.click();

  await expect(page.getByText(/Great direction\./)).toBeVisible();
  await page.waitForTimeout(500);

  await page.screenshot({
    path: 'tmp/concierge-two-turns.png',
    fullPage: false,
  });
});
