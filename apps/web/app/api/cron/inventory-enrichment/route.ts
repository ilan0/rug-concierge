import { NextRequest, NextResponse } from "next/server";
import {
  INVENTORY_ENRICHMENT_WORKER_CLAIM_LIMIT,
  INVENTORY_ENRICHMENT_WORKER_RUN_BUDGET_MS,
  runInventoryEnrichmentWorker,
} from "@/lib/inventory/enrichment-jobs";

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

  const workerId = `vercel-cron-global-${Date.now()}`;
  const summary = await runInventoryEnrichmentWorker({
    workerId,
    claimLimit: Math.max(INVENTORY_ENRICHMENT_WORKER_CLAIM_LIMIT, 12),
    runBudgetMs: Math.max(INVENTORY_ENRICHMENT_WORKER_RUN_BUDGET_MS, 55_000),
  });

  return NextResponse.json({
    ok: true,
    worker_id: workerId,
    claim_limit: Math.max(INVENTORY_ENRICHMENT_WORKER_CLAIM_LIMIT, 12),
    run_budget_ms: Math.max(INVENTORY_ENRICHMENT_WORKER_RUN_BUDGET_MS, 55_000),
    summary,
  });
}
