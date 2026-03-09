import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { CUSTOMER_URL, TRADE_TOKEN } from "./config";
import { tradeAuthContext } from "./helpers/auth";
import { cookieByName, expectPath } from "./helpers/common";

let tradeStatePath: string;

async function withTradePage(
  browser: Browser,
  fn: (page: Page, context: BrowserContext) => Promise<void>
): Promise<void> {
  const context = await browser.newContext({ storageState: tradeStatePath });
  const page = await context.newPage();
  try {
    await fn(page, context);
  } finally {
    await context.close();
  }
}

test.describe("Trade Role", () => {
  test.skip(!TRADE_TOKEN || TRADE_TOKEN.includes("[") || TRADE_TOKEN.includes("<"));

  test.beforeAll(async ({ browser }) => {
    tradeStatePath = await tradeAuthContext(browser);
  });

  test("trade entry lands on /trade with trade role cookie", async ({ browser }) => {
    await withTradePage(browser, async (page, context) => {
      await page.goto(`${CUSTOMER_URL}/trade`);
      await expectPath(page, "/trade");

      const roleCookie = await cookieByName(context, CUSTOMER_URL, "rug_ui_role");
      expect(roleCookie?.value.startsWith("trade_client.")).toBeTruthy();
    });
  });

  test("trade role route access and redirects", async ({ browser }) => {
    await withTradePage(browser, async (page) => {
      await page.goto(`${CUSTOMER_URL}/`);
      await expectPath(page, "/trade");

      await page.goto(`${CUSTOMER_URL}/trade`);
      await expectPath(page, "/trade");

      await page.goto(`${CUSTOMER_URL}/concierge`);
      await expectPath(page, "/concierge");

      for (const blockedPath of ["/inventory", "/intake", "/appraisal"]) {
        await page.goto(`${CUSTOMER_URL}${blockedPath}`);
        await expectPath(page, "/concierge");
      }
    });
  });

  test("trade nav hides staff-only links", async ({ browser }) => {
    await withTradePage(browser, async (page) => {
      await page.goto(`${CUSTOMER_URL}/trade`);
      await expect(page.getByRole("link", { name: /^Trade$/i })).toBeVisible();
      await expect(page.getByRole("link", { name: /^Concierge$/i })).toBeVisible();

      await expect(page.getByRole("link", { name: /^Inventory$/i })).toHaveCount(0);
      await expect(page.getByRole("link", { name: /^Intake$/i })).toHaveCount(0);
      await expect(page.getByRole("link", { name: /^Appraisal$/i })).toHaveCount(0);

      await page.getByRole("link", { name: /^Home$/i }).click();
      await expectPath(page, "/trade");
    });
  });
});
