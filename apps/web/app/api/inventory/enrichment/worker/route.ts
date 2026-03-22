import { NextRequest, NextResponse } from "next/server";
import {
  INVENTORY_ENRICHMENT_WORKER_CLAIM_LIMIT,
  INVENTORY_ENRICHMENT_WORKER_RUN_BUDGET_MS,
  runInventoryEnrichmentWorker,
} from "@/lib/inventory/enrichment-jobs";
import { getConfiguredTenantRuntimeSecrets } from "@/lib/tenant-secrets";

function unauthorizedResponse() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function serverMisconfiguredResponse(message: string) {
  return NextResponse.json({ error: message }, { status: 503 });
}

function isAuthorizedRequest(req: NextRequest, secret: string): boolean {
  const authorization = req.headers.get("authorization");
  if (!authorization) return false;
  return authorization === `Bearer ${secret}`;
}

export async function POST(req: NextRequest) {
  const secretsResult = await getConfiguredTenantRuntimeSecrets();
  if (!secretsResult.ok) {
    return serverMisconfiguredResponse(secretsResult.message);
  }

  const { tenantId, secrets } = secretsResult;
  if (!secrets.cronSecret) {
    return serverMisconfiguredResponse(
      `Cron secret is not configured for tenant "${tenantId}".`
    );
  }

  if (!isAuthorizedRequest(req, secrets.cronSecret)) {
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
