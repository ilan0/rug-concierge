import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { PILOT_PASSCODE, STAFF_TOKEN, STAFF_URL } from "./config";
import {
  cookieHeaderForContext,
  removeCookiesByName,
  staffAuthContext,
} from "./helpers/auth";
import { expectPath } from "./helpers/common";

let staffStatePath: string;

async function withStaffPage(
  browser: Browser,
  fn: (page: Page, context: BrowserContext) => Promise<void>
): Promise<void> {
  const context = await browser.newContext({ storageState: staffStatePath });
  const page = await context.newPage();
  try {
    await fn(page, context);
  } finally {
    await context.close();
  }
}

test.describe("Staff Deployment Authenticated", () => {
  test.beforeAll(async ({ browser }) => {
    staffStatePath = await staffAuthContext(browser);
  });

  test("home redirects directly to inventory", async ({ browser }) => {
    await withStaffPage(browser, async (page) => {
      await page.goto(`${STAFF_URL}/`);
      await expectPath(page, "/inventory");
      await expect(page.getByText(/MVP Workspace/i)).toHaveCount(0);
      await expect(page.getByText(/Select Role/i)).toHaveCount(0);
      await expect(page.getByLabel(/Store Tenant ID/i)).toHaveCount(0);
    });
  });

  test("staff role can access all workspace pages", async ({ browser }) => {
    await withStaffPage(browser, async (page) => {
      const routeChecks: Array<[string, RegExp]> = [
        ["/inventory", /Inventory Browser/i],
        ["/intake", /Inventory Intake/i],
        ["/appraisal", /Appraisal Draft Studio|Appraisal Studio/i],
        ["/concierge", /Rug Concierge/i],
        ["/trade", /Trade Support/i],
      ];

      for (const [path, heading] of routeChecks) {
        await page.goto(`${STAFF_URL}${path}`);
        await expectPath(page, path);
        await expect(page.getByRole("heading", { name: heading })).toBeVisible();
        await expect(page.getByRole("link", { name: /^Home$/i })).toBeVisible();
      }

      await page.getByRole("link", { name: /^Home$/i }).click();
      await expectPath(page, "/inventory");
    });
  });

  test("cookie loss recovery works with and without pilot cookie", async ({ browser }) => {
    await withStaffPage(browser, async (page, context) => {
      await removeCookiesByName(context, ["rug_ui_role"]);
      await page.goto(`${STAFF_URL}/inventory`);
      await expectPath(page, "/join");

      await page.goto(`${STAFF_URL}/join?token=${STAFF_TOKEN}`);
      await expectPath(page, "/inventory");
      await expect(page.getByRole("heading", { name: /Pilot Access/i })).toHaveCount(0);

      await removeCookiesByName(context, ["rug_ui_role", "rug_pilot_access"]);
      await page.goto(`${STAFF_URL}/inventory`);
      await expectPath(page, "/");
      await expect(page.getByRole("heading", { name: /Pilot Access/i })).toBeVisible();

      await page.locator("#access-code").fill(PILOT_PASSCODE);
      await page.getByRole("button", { name: /Unlock Pilot/i }).click();
      await expectPath(page, "/join");

      await page.goto(`${STAFF_URL}/join?token=${STAFF_TOKEN}`);
      await expectPath(page, "/inventory");

      const cookieHeader = await cookieHeaderForContext(context, STAFF_URL);
      expect(cookieHeader).toContain("rug_pilot_access=1");
      expect(cookieHeader).toContain("rug_ui_role=");
    });
  });
});
