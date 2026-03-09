import { expect, test } from "@playwright/test";
import { STAFF_TOKEN, STAFF_URL } from "./config";
import { staffAuthContext } from "./helpers/auth";
import { header, onePixelPngBuffer } from "./helpers/common";
import { cleanupIntakeRug } from "./helpers/intake-cleanup";

let staffStatePath: string;

test.describe("Response Headers", () => {
  test.beforeAll(async ({ browser }) => {
    staffStatePath = await staffAuthContext(browser);
  });

  test("intake response omits x-intake-storage-path and includes route/rug headers", async ({
    browser,
    playwright,
  }) => {
    const browserContext = await browser.newContext({ storageState: staffStatePath });
    const cookies = await browserContext.cookies(STAFF_URL);
    await browserContext.close();

    const cookieHeader = cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");

    const api = await playwright.request.newContext({
      baseURL: STAFF_URL,
      extraHTTPHeaders: {
        Cookie: cookieHeader,
      },
    });

    let rugId: string | null = null;
    try {
      const success = await api.post("/api/inventory/intake", {
        multipart: {
          tenant_id: "0a175457-6194-4ae9-bf4e-1a785d754c4b",
          role: "store_staff",
          intake_label: `Playwright Header Test ${Date.now()}`,
          width_ft: "5",
          width_in: "0",
          length_ft: "7",
          length_in: "0",
          image: {
            name: "test.png",
            mimeType: "image/png",
            buffer: onePixelPngBuffer(),
          },
        },
      });

      expect(success.status()).toBe(200);
      expect(header(success, "x-intake-storage-path")).toBeUndefined();
      expect(header(success, "x-intake-route-trace-id")).toBeTruthy();
      rugId = header(success, "x-intake-rug-id") ?? null;
      expect(rugId).toBeTruthy();

      if (rugId) {
        await cleanupIntakeRug(rugId);
      }

      const failure = await api.post("/api/inventory/intake", {
        multipart: {
          tenant_id: "0a175457-6194-4ae9-bf4e-1a785d754c4b",
          role: "store_staff",
          // missing intake_label
          width_ft: "5",
          width_in: "0",
          length_ft: "7",
          length_in: "0",
          image: {
            name: "test.png",
            mimeType: "image/png",
            buffer: onePixelPngBuffer(),
          },
        },
      });

      expect([400, 401, 403]).toContain(failure.status());
      expect(header(failure, "x-intake-storage-path")).toBeUndefined();
    } finally {
      if (rugId) {
        await cleanupIntakeRug(rugId).catch(() => {
          // cleanup attempted earlier; ignore duplicate cleanup failures
        });
      }
      await api.dispose();
    }
  });

  test("join Set-Cookie for role uses expected flags", async ({ request }) => {
    const response = await request.get(`${STAFF_URL}/join?token=${STAFF_TOKEN}`, {
      maxRedirects: 0,
    });

    expect(response.status()).toBe(307);
    const setCookie = response.headers()["set-cookie"] ?? "";

    expect(setCookie).toContain("rug_ui_role=store_staff.");
    expect(setCookie).toMatch(/Secure/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).not.toMatch(/HttpOnly/i);
  });
});
