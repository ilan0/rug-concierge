import { NextRequest, NextResponse } from "next/server";
import {
  INVENTORY_ENRICHMENT_WORKER_CLAIM_LIMIT,
  INVENTORY_ENRICHMENT_WORKER_RUN_BUDGET_MS,
  runInventoryEnrichmentWorker,
} from "@/lib/inventory/enrichment-jobs";

function unauthorizedResponse() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function serverMisconfiguredResponse() {
  return NextResponse.json(
    { error: "CRON_SECRET is not configured." },
    { status: 500 }
  );
}

function isAuthorizedRequest(req: NextRequest, secret: string): boolean {
  const authorization = req.headers.get("authorization");
  if (!authorization) return false;
  return authorization === `Bearer ${secret}`;
}

export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET?.trim() ?? "";
  if (!cronSecret) {
    return serverMisconfiguredResponse();
  }

  if (!isAuthorizedRequest(req, cronSecret)) {
    return unauthorizedResponse();
  }

  const workerId = `vercel-cron-${Date.now()}`;
  const summary = await runInventoryEnrichmentWorker({
    workerId,
    claimLimit: INVENTORY_ENRICHMENT_WORKER_CLAIM_LIMIT,
    runBudgetMs: INVENTORY_ENRICHMENT_WORKER_RUN_BUDGET_MS,
  });

  return NextResponse.json({
    ok: true,
    worker_id: workerId,
    claim_limit: INVENTORY_ENRICHMENT_WORKER_CLAIM_LIMIT,
    run_budget_ms: INVENTORY_ENRICHMENT_WORKER_RUN_BUDGET_MS,
    summary,
  });
}
