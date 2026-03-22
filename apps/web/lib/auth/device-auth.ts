import { createHash, createHmac, timingSafeEqual } from "node:crypto";

function toHexBuffer(value: string): Buffer | null {
  if (!/^[0-9a-f]+$/i.test(value) || value.length % 2 !== 0) return null;
  try {
    return Buffer.from(value, "hex");
  } catch {
    return null;
  }
}

export function buildDeviceAuthCookieValue(input: {
  tenantId: string;
  cookieSecret: string;
}): string {
  return createHmac("sha256", input.cookieSecret)
    .update(`device:${input.tenantId}:unlocked`)
    .digest("hex");
}

export function timingSafePasscodeMatch(input: {
  submitted: string;
  expected: string;
}): boolean {
  const submittedDigest = createHash("sha256").update(input.submitted).digest();
  const expectedDigest = createHash("sha256").update(input.expected).digest();
  return timingSafeEqual(submittedDigest, expectedDigest);
}

export function timingSafeCookieValueMatch(input: {
  submittedCookieValue: string;
  expectedCookieValue: string;
}): boolean {
  const submitted = toHexBuffer(input.submittedCookieValue);
  const expected = toHexBuffer(input.expectedCookieValue);
  if (!submitted || !expected || submitted.length !== expected.length) return false;
  return timingSafeEqual(submitted, expected);
}
