import type { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest } from "@/lib/errors/http-errors";

type ParseValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; response: NextResponse };

export async function parseJsonBodyWithSchema<TSchema extends z.ZodTypeAny>(
  req: Request,
  schema: TSchema,
  invalidMessage = "Invalid request payload."
): Promise<ParseValidationResult<z.infer<TSchema>>> {
  const raw = (await req.json().catch(() => null)) as unknown;
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, response: badRequest(invalidMessage) };
  }
  return { ok: true, value: parsed.data };
}

export async function parseRouteParamsWithSchema<TSchema extends z.ZodTypeAny>(
  params: Promise<unknown>,
  schema: TSchema,
  invalidMessage = "Invalid route params."
): Promise<ParseValidationResult<z.infer<TSchema>>> {
  const raw = await params;
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, response: badRequest(invalidMessage) };
  }
  return { ok: true, value: parsed.data };
}

export function parseSearchParamsWithSchema<TSchema extends z.ZodTypeAny>(
  searchParams: URLSearchParams,
  schema: TSchema,
  invalidMessage = "Invalid query params."
): ParseValidationResult<z.infer<TSchema>> {
  const raw = Object.fromEntries(searchParams.entries());
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, response: badRequest(invalidMessage) };
  }
  return { ok: true, value: parsed.data };
}

