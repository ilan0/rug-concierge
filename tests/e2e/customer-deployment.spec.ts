import { expect, test } from "@playwright/test";
import { CUSTOMER_URL, TENANT_ID } from "./config";
import { cookieByName, expectPath, pathnameFromUrl } from "./helpers/common";

test.describe("Customer Deployment", () => {
  test.use({ baseURL: CUSTOMER_URL });

  test("routing and concierge surface", async ({ page }) => {
    await page.goto("/");
    await expectPath(page, "/concierge");

    await expect(page.getByRole("heading", { name: /Rug Concierge/i })).toBeVisible();
    await expect(page.locator("textarea")).toBeVisible();
    await expect(page.getByText(/MVP Workspace/i)).toHaveCount(0);
    await expect(page.getByText(/Select Role/i)).toHaveCount(0);
    await expect(page.getByText(/Store Tenant ID/i)).toHaveCount(0);

    for (const path of ["/inventory", "/intake", "/appraisal", "/trade"]) {
      await page.goto(path);
      await expectPath(page, "/concierge");
    }
  });

  test("join without token auto-sets retail cookie and redirects", async ({ page, context }) => {
    await page.goto("/join");
    await expectPath(page, "/concierge");

    const roleCookie = await cookieByName(context, CUSTOMER_URL, "rug_ui_role");
    expect(roleCookie).not.toBeNull();
    expect(roleCookie?.value.startsWith("retail_customer.")).toBeTruthy();
    expect(roleCookie?.secure).toBeTruthy();
    expect(roleCookie?.sameSite).toBe("Lax");
    expect(roleCookie?.httpOnly).toBeFalsy();

    const tenantCookie = await cookieByName(context, CUSTOMER_URL, "rug_ui_tenant_id");
    expect(tenantCookie?.value).toBe(TENANT_ID);
  });

  test("chat pipeline sends messages and persists on refresh", async ({ page }) => {
    await page.goto("/concierge");
    const composer = page.locator("textarea");
    const sendButton = page.getByRole("button", { name: /^Send$/i });

    await composer.fill("Show me what you have");
    const beforeCount = await page.locator("article").count();
    await sendButton.click();

    await expect
      .poll(async () => page.locator("article").count(), { timeout: 20_000 })
      .toBeGreaterThan(beforeCount);
    await expect(page.getByText(/Message failed/i)).toHaveCount(0);

    await composer.fill("I need an 8x10 rug under $2000 for a dining room");
    const beforeSecond = await page.locator("article").count();
    await sendButton.click();

    await expect
      .poll(async () => page.locator("article").count(), { timeout: 20_000 })
      .toBeGreaterThan(beforeSecond);

    const totalTurns = await page.locator("article").count();
    await page.reload();
    await expectPath(page, "/concierge");
    await expect(page.locator("textarea")).toBeVisible();
    await expect
      .poll(async () => page.locator("article").count(), { timeout: 20_000 })
      .toBeGreaterThan(0);
    expect(totalTurns).toBeGreaterThan(1);
  });

  test("api role escalation is blocked without cookies", async ({ request }) => {
    const chatResponse = await request.post(`${CUSTOMER_URL}/api/chat`, {
      data: {
        role: "store_staff",
        session_id: "playwright-customer-role-check",
        message: "show me what you have",
        tenant_id: TENANT_ID,
      },
    });

    if (chatResponse.status() === 200) {
      const body = await chatResponse.json();
      expect(body.role).not.toBe("store_staff");
    } else {
      expect(chatResponse.status()).toBe(403);
    }

    const recommendResponse = await request.post(`${CUSTOMER_URL}/api/recommend`, {
      data: {
        role: "store_staff",
        tenant_id: TENANT_ID,
        user_message: "show me options",
      },
    });

    if (recommendResponse.status() === 200) {
      const body = await recommendResponse.json();
      expect(body.role).not.toBe("store_staff");
    } else {
      expect([400, 403]).toContain(recommendResponse.status());
    }
  });

  test("/join invalid token on customer does not set role cookie", async ({ page, context }) => {
    await page.goto("/join?token=totallyinvalid");
    expect(pathnameFromUrl(page.url())).toBe("/join");
    await expect(page.getByText(/Invalid Or Expired Link/i)).toBeVisible();

    const roleCookie = await cookieByName(context, CUSTOMER_URL, "rug_ui_role");
    expect(roleCookie).toBeNull();
  });
});
