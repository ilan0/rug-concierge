import { NextResponse } from "next/server";
import {
  fetchAppraisalDrafts,
  saveManualAppraisalDraft,
} from "@/lib/appraisal/service";
import { requirePilotAccessApi } from "@/lib/auth/pilot-access";
import { normalizeTenantId, resolveAuthoritativeTenantForServer } from "@/lib/auth/tenant";
import { canRoleGenerateAppraisal } from "@/lib/auth/policy";
import { resolveApiRoleOrError } from "@/lib/http/guards";
import { parseJsonObjectBody } from "@/lib/http/validators";
import type { RoleType } from "@/lib/chat/types";
import type { AppraisalInput, AppraisalSourceType, AppraisalStatus } from "@/lib/types/appraisal";

function normalizeStatus(value: unknown): AppraisalStatus | null {
  return value === "draft" ||
    value === "reviewed" ||
    value === "finalized" ||
    value === "void"
    ? value
    : null;
}

function normalizeSourceType(value: unknown): AppraisalSourceType {
  return value === "inventory_linked" ? "inventory_linked" : "customer_owned";
}

function statusForErrorCode(code: string): number {
  if (code === "FORBIDDEN") return 403;
  if (code === "INTERNAL_ERROR") return 500;
  return 400;
}

/**
 * GET /api/appraisal/drafts
 * Read recent persisted appraisal drafts for tenant-scoped staff workflows.
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
        error: "Appraisal drafts are available only for store staff or developer.",
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

  const limitRaw = searchParams.get("limit");
  const status = normalizeStatus(searchParams.get("status"));
  const parsedLimit = limitRaw ? Number.parseInt(limitRaw, 10) : null;
  const limit = parsedLimit !== null && Number.isFinite(parsedLimit) ? parsedLimit : undefined;

  const rows = await fetchAppraisalDrafts({
    tenantId,
    status,
    limit,
  });

  return NextResponse.json({ rows, total: rows.length });
}

/**
 * POST /api/appraisal/drafts
 * Persist manual save/review/finalize actions for appraisal records.
 */
export async function POST(req: Request) {
  const pilotBlocked = await requirePilotAccessApi();
  if (pilotBlocked) return pilotBlocked;

  const parsed = await parseJsonObjectBody<{
    role?: RoleType;
    user_role?: RoleType;
    tenant_id?: unknown;
    source_type?: unknown;
    rug_id?: unknown;
    appraisal_id?: unknown;
    status?: unknown;
    appraisal_context?: unknown;
    draft_payload?: unknown;
    draft_text?: unknown;
    final_text?: unknown;
  }>(req);
  if (!parsed.ok) return parsed.response;

  const body = parsed.body;
  const roleResult = await resolveApiRoleOrError({
    role: body.role,
    user_role: body.user_role,
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
        error: "Appraisal save is available only for store staff or developer.",
        code: "FORBIDDEN",
      },
      { status: 403 }
    );
  }

  const tenantId = resolveAuthoritativeTenantForServer({
    requestTenantId: normalizeTenantId(body.tenant_id),
  });
  if (!tenantId) {
    return NextResponse.json(
      { error: "tenant_id is required.", code: "BAD_REQUEST" },
      { status: 400 }
    );
  }

  const status = normalizeStatus(body.status);
  if (!status) {
    return NextResponse.json(
      { error: "status must be draft/reviewed/finalized/void.", code: "BAD_REQUEST" },
      { status: 400 }
    );
  }

  const draftPayload =
    body.draft_payload && typeof body.draft_payload === "object"
      ? (body.draft_payload as Record<string, unknown>)
      : null;
  if (!draftPayload) {
    return NextResponse.json(
      { error: "draft_payload must be an object.", code: "BAD_REQUEST" },
      { status: 400 }
    );
  }

  const saved = await saveManualAppraisalDraft({
    tenantId,
    sourceType: normalizeSourceType(body.source_type),
    appraisalId: typeof body.appraisal_id === "string" ? body.appraisal_id : null,
    rugId: typeof body.rug_id === "string" ? body.rug_id : null,
    status,
    appraisalContext:
      body.appraisal_context && typeof body.appraisal_context === "object"
        ? (body.appraisal_context as AppraisalInput)
        : {},
    draftPayload,
    draftText: typeof body.draft_text === "string" ? body.draft_text : null,
    finalText: typeof body.final_text === "string" ? body.final_text : null,
  });
  if (!saved.ok) {
    return NextResponse.json(
      { error: saved.error.message, code: saved.error.code },
      { status: statusForErrorCode(saved.error.code) }
    );
  }

  return NextResponse.json({
    appraisal_id: saved.id,
    persisted: saved.persisted,
    quality: saved.quality,
  });
}
