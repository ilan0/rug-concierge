import { createHmac, timingSafeEqual } from "node:crypto";
import type { AppRole } from "@/lib/auth/roles";
import { isAppRole } from "@/lib/auth/roles";
import { getCookieSecret } from "@/lib/auth/deployment";

export const ROLE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

function toBase64Url(input: Buffer): string {
  return input
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function signPayload(payload: string): string {
  const secret = getCookieSecret();
  const digest = createHmac("sha256", secret).update(payload).digest();
  return toBase64Url(digest);
}

function safeCompare(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function roleTenantPayload(role: AppRole, tenantId: string): string {
  return `${role}:${tenantId}`;
}

export function createSignedRoleCookieValue(role: AppRole, tenantId: string): string {
  const signature = signPayload(roleTenantPayload(role, tenantId));
  return `${role}.${signature}`;
}

export function parseRoleFromCookieValue(raw: string | null | undefined): AppRole | null {
  if (typeof raw !== "string") return null;
  const rolePart = raw.split(".")[0]?.trim();
  if (!rolePart || !isAppRole(rolePart)) return null;
  return rolePart;
}

export function verifySignedRoleCookieValue(input: {
  rawCookieValue: string | null | undefined;
  tenantId: string | null;
}): AppRole | null {
  if (!input.tenantId) return null;
  if (typeof input.rawCookieValue !== "string") return null;

  const dot = input.rawCookieValue.indexOf(".");
  if (dot <= 0 || dot === input.rawCookieValue.length - 1) return null;

  const rolePart = input.rawCookieValue.slice(0, dot).trim();
  const signaturePart = input.rawCookieValue.slice(dot + 1).trim();
  if (!isAppRole(rolePart) || signaturePart.length === 0) return null;

  const expected = signPayload(roleTenantPayload(rolePart, input.tenantId));
  if (!safeCompare(signaturePart, expected)) return null;
  return rolePart;
}
