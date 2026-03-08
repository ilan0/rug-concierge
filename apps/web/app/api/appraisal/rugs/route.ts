import { NextResponse } from "next/server";
import { fetchInventoryLinkedRugs } from "@/lib/appraisal/service";
import { requirePilotAccessApi } from "@/lib/auth/pilot-access";
import { normalizeTenantId, resolveAuthoritativeTenantForServer } from "@/lib/auth/tenant";
import { canRoleGenerateAppraisal } from "@/lib/auth/policy";
import { resolveApiRoleOrError } from "@/lib/http/guards";
import type { RoleType } from "@/lib/chat/types";

/**
 * GET /api/appraisal/rugs
 * Tenant-scoped rug selector endpoint for inventory-linked appraisal flows.
 */
export async function GET(req: Request) {
  const pilotBlocked = await requirePilotAccessApi();
  if (pilotBlocked) return pilotBlocked;

  const { searchParams } = new URL(req.url);
  const role = searchParams.get("role") ?? undefined;
  const userRole = searchParams.get("user_role") ?? undefined;

  const roleResult = await resolveApiRoleOrError({
    role: role as RoleType | undefined,
    user_role: userRole as RoleType | undefined,
    defaultRole: "retail_customer",
  });
  if (!roleResult.ok) {
    return NextResponse.json(
      {
        error: roleResult.message,
        code: roleResult.status === 400 ? "BAD_REQUEST" : "FORBIDDEN",
      },
      { status: roleResult.status }
    );
  }
  if (!canRoleGenerateAppraisal(roleResult.role)) {
    return NextResponse.json(
      {
        error: "Appraisal inventory lookup is available only for store staff or developer.",
        code: "FORBIDDEN",
      },
      { status: 403 }
    );
  }

  const tenantId = resolveAuthoritativeTenantForServer({
    requestTenantId: normalizeTenantId(searchParams.get("tenant_id")),
  });
  if (!tenantId) {
    return NextResponse.json(
      { error: "tenant_id is required.", code: "BAD_REQUEST" },
      { status: 400 }
    );
  }

  const q = searchParams.get("q");
  const status = searchParams.get("status");
  const limitRaw = searchParams.get("limit");
  const parsedLimit = limitRaw ? Number.parseInt(limitRaw, 10) : null;
  const limit = parsedLimit !== null && Number.isFinite(parsedLimit) ? parsedLimit : undefined;

  const rows = await fetchInventoryLinkedRugs({
    tenantId,
    q,
    status,
    limit,
  });

  return NextResponse.json({
    rows,
    total: rows.length,
  });
}
