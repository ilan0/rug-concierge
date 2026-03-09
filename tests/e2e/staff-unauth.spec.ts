import { expect, test } from "@playwright/test";
import { PILOT_PASSCODE, STAFF_TOKEN, STAFF_URL, TENANT_ID } from "./config";
import { cookieByName, expectPath } from "./helpers/common";

test.describe("Staff Deployment Unauthenticated", () => {
  test.use({ baseURL: STAFF_URL });

  test("pilot gate protects workspace routes", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /Pilot Access/i })).toBeVisible();
    await expect(page.getByText(/MVP Workspace/i)).toHaveCount(0);

    for (const path of ["/inventory", "/concierge", "/intake", "/appraisal"]) {
      await page.goto(path);
      await expectPath(page, "/");
      await expect(page.getByRole("heading", { name: /Pilot Access/i })).toBeVisible();
    }
  });

  test("join without token shows recovery page and does not set cookies", async ({ page, context }) => {
    await page.goto("/join");
    await expectPath(page, "/join");
    await expect(page.getByText(/Use Your Access Link/i)).toBeVisible();
    await expect(page.getByRole("link", { name: /Back to Access Gate/i })).toBeVisible();

    const roleCookie = await cookieByName(context, STAFF_URL, "rug_ui_role");
    expect(roleCookie).toBeNull();
  });

  test("invalid join tokens render invalid page and set no role cookie", async ({ page, context }) => {
    for (const token of [
      "totallyinvalid",
      "",
      "eca015064eb935b2846267deba48948523ba485812d13962d37fe6593fae247f",
    ]) {
      const started = Date.now();
      await page.goto(`/join?token=${token}`);
      const elapsed = Date.now() - started;
      expect(elapsed).toBeLessThan(5_000);
      await expect(page.getByText(/Invalid Or Expired Link|Use Your Access Link/i)).toBeVisible();

      const roleCookie = await cookieByName(context, STAFF_URL, "rug_ui_role");
      expect(roleCookie).toBeNull();
      await context.clearCookies();
    }
  });

  test("valid staff token flow reaches inventory after passcode", async ({ page, context }) => {
    await page.goto(`/join?token=${STAFF_TOKEN}`);
    await expectPath(page, "/");
    await expect(page.getByRole("heading", { name: /Pilot Access/i })).toBeVisible();

    const prePilotRole = await cookieByName(context, STAFF_URL, "rug_ui_role");
    expect(prePilotRole?.value.startsWith("store_staff.")).toBeTruthy();

    await page.locator("#access-code").fill(PILOT_PASSCODE);
    await page.getByRole("button", { name: /Unlock Pilot/i }).click();

    await page.goto(`/join?token=${STAFF_TOKEN}`);
    await expectPath(page, "/inventory");
    await expect(page.getByRole("heading", { name: /Inventory Browser/i })).toBeVisible();
    await expect(page.getByText(new RegExp(`Tenant:\\s*${TENANT_ID}`))).toBeVisible();
  });
});
