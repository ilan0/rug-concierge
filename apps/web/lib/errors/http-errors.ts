import { NextResponse } from "next/server";

type ErrorCode =
  | "BAD_REQUEST"
  | "CHAT_INTERNAL_ERROR"
  | "RECOMMENDATION_PIPELINE_ERROR"
  | "FORBIDDEN";

export function badRequest(message: string, code: ErrorCode = "BAD_REQUEST") {
  return NextResponse.json({ error: message, code }, { status: 400 });
}

export function internalError(
  message: string,
  code: ErrorCode = "CHAT_INTERNAL_ERROR"
) {
  return NextResponse.json({ error: message, code }, { status: 500 });
}

export function forbidden(message: string, code: ErrorCode = "FORBIDDEN") {
  return NextResponse.json({ error: message, code }, { status: 403 });
}
