import { expect, test } from "@playwright/test";

test("concierge route loads", async ({ page }) => {
  await page.goto("/concierge");
  await expect(page).toHaveURL(/\/concierge/);
});
