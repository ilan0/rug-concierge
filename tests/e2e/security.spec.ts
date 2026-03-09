import { expect, test } from "@playwright/test";
import { CUSTOMER_URL, STAFF_URL, TENANT_ID } from "./config";

function oneCharOff(value: string): string {
  if (!value.length) return value;
  const last = value[value.length - 1];
  const next = last === "f" ? "e" : "f";
  return `${value.slice(0, -1)}${next}`;
}

test.describe("Security Boundaries", () => {
  test("forged role cookies are rejected for page access", async ({ browser }) => {
    const host = new URL(STAFF_URL).hostname;

    for (const forged of [
      "store_staff",
      "store_staff.badsignature",
      "store_staff.",
      ".validsignature",
    ]) {
      const context = await browser.newContext();
      await context.addCookies([
        {
          name: "rug_pilot_access",
          value: "1",
          domain: host,
          path: "/",
          secure: true,
          httpOnly: false,
          sameSite: "Lax",
        },
        {
          name: "rug_ui_tenant_id",
          value: TENANT_ID,
          domain: host,
          path: "/",
          secure: true,
          httpOnly: false,
          sameSite: "Lax",
        },
        {
          name: "rug_ui_role",
          value: forged,
          domain: host,
          path: "/",
          secure: true,
          httpOnly: false,
          sameSite: "Lax",
        },
      ]);

      const page = await context.newPage();
      await page.goto(`${STAFF_URL}/inventory`);
      const path = new URL(page.url()).pathname;
      expect(path).not.toBe("/inventory");
      await context.close();
    }
  });

  test("request body role escalation is blocked on customer", async ({ request }) => {
    const attempts = [
      { role: "store_staff" },
      { role: "developer" },
      { user_role: "store_staff" },
      { role: "store_staff", user_role: "store_staff" },
    ];

    for (const attempt of attempts) {
      const response = await request.post(`${CUSTOMER_URL}/api/chat`, {
        data: {
          ...attempt,
          session_id: "playwright-escalation-customer",
          message: "show me what you have",
          tenant_id: TENANT_ID,
        },
      });
      if (response.status() === 200) {
        const body = await response.json();
        expect(body.role).not.toMatch(/store_staff|developer/);
      } else {
        expect([400, 403]).toContain(response.status());
      }
    }
  });

  test("request body role escalation is blocked on staff without cookies", async ({ request }) => {
    for (const role of ["trade_client", "store_staff"]) {
      const response = await request.post(`${STAFF_URL}/api/chat`, {
        data: {
          role,
          session_id: `playwright-escalation-staff-${role}`,
          message: "show me what you have",
          tenant_id: TENANT_ID,
        },
      });
      expect([401, 403]).toContain(response.status());
    }
  });

  test("tenant injection does not break customer tenant authority", async ({ playwright }) => {
    const api = await playwright.request.newContext({ baseURL: CUSTOMER_URL });
    try {
      // Establish retail cookie session.
      await api.get("/join");

      const first = await api.post("/api/chat", {
        data: {
          message: "show me what you have",
          session_id: "playwright-tenant-injection",
          tenant_id: "00000000-0000-0000-0000-000000000000",
        },
      });
      expect(first.status()).toBe(200);
      const firstBody = await first.json();

      const second = await api.post("/api/chat", {
        data: {
          message: "show me more",
          session_id: firstBody.session_id,
          tenant_id: TENANT_ID,
        },
      });
      expect(second.status()).toBe(200);

      const recommend = await api.post("/api/recommend", {
        data: {
          user_message: "show me options",
          tenant_id: "00000000-0000-0000-0000-000000000000",
        },
      });
      expect([200, 400]).toContain(recommend.status());
      expect(recommend.status()).not.toBe(403);
    } finally {
      await api.dispose();
    }
  });

  test("invalid join tokens return quickly (coarse timing sanity)", async ({ request }) => {
    const invalids = [
      "totallyinvalidtoken",
      oneCharOff("eca015064eb935b2846267deba48948523ba485812d13962d37fe6593fae247e"),
    ];

    for (const token of invalids) {
      const started = Date.now();
      const response = await request.get(`${STAFF_URL}/join?token=${token}`);
      const elapsed = Date.now() - started;
      expect(elapsed).toBeLessThan(5_000);
      expect(response.status()).toBe(200);
      expect(await response.text()).toMatch(/Invalid Or Expired Link|Use Your Access Link/i);
    }
  });
});
