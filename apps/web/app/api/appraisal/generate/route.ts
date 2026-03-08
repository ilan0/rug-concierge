import { NextResponse } from "next/server";
import { runAppraisalGeneration } from "@/lib/appraisal/service";
import {
  parseE2eTraceMeta,
  writeE2eTraceArtifact,
} from "@/lib/qa/e2e-trace";
import { forbidden } from "@/lib/errors/http-errors";
import { normalizeTenantId, resolveAuthoritativeTenantForServer } from "@/lib/auth/tenant";
import { canRoleGenerateAppraisal } from "@/lib/auth/policy";
import { requirePilotAccessApi } from "@/lib/auth/pilot-access";
import { resolveApiRoleOrError } from "@/lib/http/guards";
import { parseJsonObjectBody } from "@/lib/http/validators";
import type { AppraisalGenerateRequest } from "@/lib/types/appraisal";
import type { RoleType } from "@/lib/chat/types";

function statusForErrorCode(code: string): number {
  if (code === "FORBIDDEN") return 403;
  if (code === "INTERNAL_ERROR") return 500;
  return 400;
}

/**
 * POST /api/appraisal/generate
 * Dedicated staff/developer endpoint for appraisal draft generation.
 * Supports inventory-linked and customer-owned source modes.
 */
export async function POST(req: Request) {
  const pilotBlocked = await requirePilotAccessApi();
  if (pilotBlocked) return pilotBlocked;

  const traceMeta = parseE2eTraceMeta(req);
  const traceId = crypto.randomUUID();
  const parsedBody = await parseJsonObjectBody<{
    role?: RoleType;
    user_role?: RoleType;
    tenant_id?: unknown;
    source_type?: unknown;
    rug_id?: unknown;
    appraisal_id?: unknown;
    persist?: unknown;
    appraisal_context?: unknown;
  }>(req);

  if (!parsedBody.ok) {
    if (traceMeta) {
      await writeE2eTraceArtifact({
        meta: traceMeta,
        channel: "appraisal-route",
        trace_id: traceId,
        payload: {
          flow_path: ["/api/appraisal/generate POST", "request_validation_failed"],
          request: null,
          response: {
            status: 400,
            body: { error: "Invalid request body" },
          },
        },
      });
    }
    const response = NextResponse.json(
      { error: "Invalid request body", code: "BAD_REQUEST" },
      { status: 400 }
    );
    if (traceMeta) response.headers.set("x-appraisal-trace-id", traceId);
    return response;
  }

  const body = parsedBody.body;
  const roleResult = await resolveApiRoleOrError({
    role: body.role,
    user_role: body.user_role,
    defaultRole: "retail_customer",
  });
  if (!roleResult.ok) {
    const response = NextResponse.json(
      { error: roleResult.message, code: roleResult.status === 400 ? "BAD_REQUEST" : "FORBIDDEN" },
      { status: roleResult.status }
    );
    if (traceMeta) response.headers.set("x-appraisal-trace-id", traceId);
    return response;
  }

  if (!canRoleGenerateAppraisal(roleResult.role)) {
    const deny = forbidden(
      "Appraisal generation is available only for store staff or developer."
    );
    if (traceMeta) {
      await writeE2eTraceArtifact({
        meta: traceMeta,
        channel: "appraisal-route",
        trace_id: traceId,
        payload: {
          flow_path: ["/api/appraisal/generate POST", "role_check_failed_non_staff_block"],
          request: {
            role: body.role ?? null,
            resolved_role: roleResult.role,
          },
          response: {
            status: 403,
            body: {
              error: "Appraisal generation is available only for store staff or developer.",
              code: "FORBIDDEN",
            },
          },
        },
      });
    }
    if (traceMeta) deny.headers.set("x-appraisal-trace-id", traceId);
    return deny;
  }

  const tenantId = resolveAuthoritativeTenantForServer({
    requestTenantId: normalizeTenantId(body.tenant_id),
  });
  if (!tenantId) {
    const response = NextResponse.json(
      { error: "tenant_id is required for appraisal generation.", code: "BAD_REQUEST" },
      { status: 400 }
    );
    if (traceMeta) response.headers.set("x-appraisal-trace-id", traceId);
    return response;
  }

  const request: AppraisalGenerateRequest = {
    role: body.role,
    user_role: body.user_role,
    tenant_id: tenantId,
    source_type:
      body.source_type === "inventory_linked" || body.source_type === "customer_owned"
        ? body.source_type
        : undefined,
    rug_id: typeof body.rug_id === "string" ? body.rug_id : null,
    appraisal_id:
      typeof body.appraisal_id === "string" ? body.appraisal_id : null,
    persist: typeof body.persist === "boolean" ? body.persist : true,
    appraisal_context:
      body.appraisal_context && typeof body.appraisal_context === "object"
        ? (body.appraisal_context as AppraisalGenerateRequest["appraisal_context"])
        : {},
  };

  const generated = await runAppraisalGeneration({
    request,
    tenantId,
    model: process.env.OPENAI_MODEL ?? "gpt-4.1-nano",
  });

  if (!generated.ok) {
    const status = statusForErrorCode(generated.error.code);
    if (traceMeta) {
      await writeE2eTraceArtifact({
        meta: traceMeta,
        channel: "appraisal-route",
        trace_id: traceId,
        payload: {
          flow_path: ["/api/appraisal/generate POST", "request_validation_failed"],
          request,
          response: {
            status,
            body: {
              error: generated.error.message,
              code: generated.error.code,
            },
          },
        },
      });
    }
    const response = NextResponse.json(
      { error: generated.error.message, code: generated.error.code },
      { status }
    );
    if (traceMeta) response.headers.set("x-appraisal-trace-id", traceId);
    return response;
  }

  if (traceMeta) {
    await writeE2eTraceArtifact({
      meta: traceMeta,
      channel: "appraisal-route",
      trace_id: traceId,
      payload: {
        flow_path: ["/api/appraisal/generate POST", "runAppraisalGeneration"],
        request,
        response: {
          status: 200,
          body: {
            mode: generated.response.mode,
            appraisal_id: generated.response.appraisal_id,
            persisted: generated.response.persisted,
            source_type: generated.response.source_type,
            quality: generated.response.quality,
          },
        },
      },
    });
  }

  const response = NextResponse.json(generated.response);
  if (traceMeta) response.headers.set("x-appraisal-trace-id", traceId);
  return response;
}
