import type { NextResponse } from "next/server";
import { badRequest } from "@/lib/errors/http-errors";

type ParseJsonObjectResult<T extends Record<string, unknown>> =
  | { ok: true; body: T }
  | { ok: false; response: NextResponse };

export async function parseJsonObjectBody<T extends Record<string, unknown>>(
  req: Request,
  invalidMessage = "Invalid request body"
): Promise<ParseJsonObjectResult<T>> {
  const body = (await req.json().catch(() => null)) as T | null;
  if (!body || typeof body !== "object") {
    return { ok: false, response: badRequest(invalidMessage) };
  }
  return { ok: true, body };
}

export function validateOptionalObjectField(
  value: unknown,
  fieldName: string
): string | null {
  if (value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return `${fieldName} must be an object when provided.`;
  }
  return null;
}

export function readTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function readUserMessage(input: {
  user_message?: unknown;
  message?: unknown;
}): string {
  const preferred = readTrimmedString(input.user_message);
  if (preferred) return preferred;
  return readTrimmedString(input.message);
}
