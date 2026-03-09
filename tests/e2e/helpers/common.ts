import { expect, type APIResponse, type BrowserContext, type Page } from "@playwright/test";

export const ONE_PIXEL_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2+7X0AAAAASUVORK5CYII=";

export function onePixelPngBuffer(): Buffer {
  return Buffer.from(ONE_PIXEL_PNG_BASE64, "base64");
}

export function pathnameFromUrl(raw: string): string {
  return new URL(raw).pathname;
}

export async function expectPath(page: Page, path: string): Promise<void> {
  await expect
    .poll(() => pathnameFromUrl(page.url()), { timeout: 20_000 })
    .toBe(path);
}

export async function cookieByName(
  context: BrowserContext,
  origin: string,
  name: string
) {
  const cookies = await context.cookies(origin);
  return cookies.find((cookie) => cookie.name === name) ?? null;
}

export function header(response: APIResponse, name: string): string | undefined {
  const headers = response.headers();
  return headers[name.toLowerCase()];
}
