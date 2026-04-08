import { NextRequest, NextResponse } from "next/server";
import { runIntakeOrphanCleanup } from "@/lib/inventory/intake-orphan-cleanup";

export const runtime = "nodejs";

function isVercelCronRequest(req: NextRequest): boolean {
  const configuredCronSecret = process.env.CRON_SECRET?.trim() ?? "";
  if (configuredCronSecret.length > 0) {
    const authHeader = req.headers.get("authorization");
    return authHeader === `Bearer ${configuredCronSecret}`;
  }

  const cronHeader = req.headers.get("x-vercel-cron");
  return typeof cronHeader === "string" && cronHeader.trim().length > 0;
}

function unauthorizedResponse() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function GET(req: NextRequest) {
  if (!isVercelCronRequest(req)) {
    return unauthorizedResponse();
  }

  const summary = await runIntakeOrphanCleanup();
  return NextResponse.json({
    ok: true,
    summary,
  });
}
