import fs from "node:fs/promises";
import path from "node:path";
import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { STAFF_TOKEN, STAFF_URL, TRADE_TOKEN } from "../config";

const AUTH_DIR = path.resolve(process.cwd(), "test-results/.auth");

function targetStatePath(name: string): string {
  return path.resolve(AUTH_DIR, `${name}.json`);
}

export async function ensureAuthDir(): Promise<void> {
  await fs.mkdir(AUTH_DIR, { recursive: true });
}

export async function cookieHeaderForContext(
  context: BrowserContext,
  origin: string
): Promise<string> {
  const cookies = await context.cookies(origin);
  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}

export async function removeCookiesByName(
  context: BrowserContext,
  names: string[]
): Promise<void> {
  const allCookies = await context.cookies();
  const keep = allCookies.filter((cookie) => !names.includes(cookie.name));
  await context.clearCookies();
  if (keep.length > 0) {
    await context.addCookies(keep);
  }
}

async function createStaffLikeState(input: {
  browser: Browser;
  token: string;
  expectedPath: "/inventory" | "/trade";
  stateName: "staff" | "trade";
}): Promise<string> {
  await ensureAuthDir();
  const statePath = targetStatePath(input.stateName);

  const context = await input.browser.newContext();
  const host = new URL(STAFF_URL).hostname;
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
  ]);
  const page = await context.newPage();
  await page.goto(`${STAFF_URL}/join?token=${input.token}`, {
    waitUntil: "domcontentloaded",
  });

  await expect
    .poll(() => new URL(page.url()).pathname, { timeout: 20_000 })
    .toBe(input.expectedPath);

  await context.storageState({ path: statePath });
  await context.close();
  return statePath;
}

export async function staffAuthContext(browser: Browser): Promise<string> {
  return createStaffLikeState({
    browser,
    token: STAFF_TOKEN,
    expectedPath: "/inventory",
    stateName: "staff",
  });
}

export async function tradeAuthContext(browser: Browser): Promise<string> {
  if (!TRADE_TOKEN || TRADE_TOKEN.includes("[") || TRADE_TOKEN.includes("<")) {
    throw new Error("TRADE_TOKEN is missing in tests/e2e/config.ts");
  }

  return createStaffLikeState({
    browser,
    token: TRADE_TOKEN,
    expectedPath: "/trade",
    stateName: "trade",
  });
}
