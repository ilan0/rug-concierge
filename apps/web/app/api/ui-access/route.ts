import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ required: false, verified: true });
}
