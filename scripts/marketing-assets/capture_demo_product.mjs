import { chromium } from "playwright";
import { createHmac } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const OUTPUT_DIR = "apps/site/public/media/source";
const TENANT_ID = "d0d97eca-5384-4f35-a970-db7031c188b0";

function requiredEnv(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

async function loadCookieSecret() {
  const supabase = createClient(
    requiredEnv("SUPABASE_URL"),
    requiredEnv("SUPABASE_SECRET_KEY"),
    { auth: { persistSession: false } }
  );

  const { data, error } = await supabase
    .from("tenants")
    .select("secrets")
    .eq("id", TENANT_ID)
    .single();

  if (error) throw error;
  const secret = data?.secrets?.cookie_secret;
  if (typeof secret !== "string" || secret.trim().length === 0) {
    throw new Error(`Missing cookie_secret for tenant ${TENANT_ID}`);
  }

  return secret.trim();
}

function buildStaffCookieValue(cookieSecret) {
  return createHmac("sha256", cookieSecret)
    .update(`device:${TENANT_ID}:unlocked`)
    .digest("hex");
}

async function shot(page, context, filename) {
  const client = await context.newCDPSession(page);
  const { data } = await client.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
  });
  writeFileSync(join(OUTPUT_DIR, filename), Buffer.from(data, "base64"));
}

async function run() {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const cookieSecret = await loadCookieSecret();
  const browser = await chromium.launch({ headless: true });

  const conciergeContext = await browser.newContext({
    viewport: { width: 1440, height: 1600 },
    extraHTTPHeaders: { "x-forwarded-host": "demo.rugdesk.app" },
  });
  const conciergePage = await conciergeContext.newPage();

  await conciergePage.goto("http://127.0.0.1:3000/concierge", {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await conciergePage.waitForTimeout(2500);
  await shot(conciergePage, conciergeContext, "explore-concierge.png");
  await conciergePage.getByRole("button", { name: /tap to start/i }).click();
  await conciergePage.waitForTimeout(1600);
  await shot(conciergePage, conciergeContext, "explore-active-chat.png");
  await conciergeContext.close();

  const staffContext = await browser.newContext({
    viewport: { width: 1440, height: 1600 },
    extraHTTPHeaders: { "x-forwarded-host": "demo.rugdesk.app" },
  });
  await staffContext.addCookies([
    {
      name: "staff_unlocked",
      value: buildStaffCookieValue(cookieSecret),
      url: "http://127.0.0.1:3000/",
    },
  ]);

  const staffPage = await staffContext.newPage();
  await staffPage.goto("http://127.0.0.1:3000/inventory", {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await staffPage.waitForTimeout(3000);
  await shot(staffPage, staffContext, "explore-inventory.png");
  await staffPage.getByLabel(/Edit /).first().click();
  await staffPage.waitForTimeout(1500);
  await shot(staffPage, staffContext, "explore-inventory-detail-modal.png");

  await staffPage.goto("http://127.0.0.1:3000/intake", {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await staffPage.waitForTimeout(3000);
  await shot(staffPage, staffContext, "explore-intake.png");
  await staffContext.close();
  await browser.close();
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
