import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST() {
  return NextResponse.json(
    {
      error:
        "Multipart intake upload is no longer supported. Use /api/inventory/intake/upload-session and /api/inventory/intake/finalize.",
      code: "INTAKE_MULTIPART_DEPRECATED",
    },
    { status: 410 }
  );
}
