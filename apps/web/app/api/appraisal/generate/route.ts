import { NextResponse } from "next/server";
import {
  generateAppraisalDraft,
  toAppraisalRequestPayloadPreview,
  toAppraisalResponsePayloadPreview,
  type AppraisalAiTrace,
} from "@/lib/ai/appraisal";
import {
  parseE2eTraceMeta,
  writeE2eTraceArtifact,
} from "@/lib/qa/e2e-trace";
import { canRoleGenerateAppraisal } from "@/lib/auth/policy";
import { requirePilotAccessApi } from "@/lib/auth/pilot-access";
import { normalizeTenantId } from "@/lib/auth/tenant";
import { resolveApiRoleOrError } from "@/lib/http/guards";
import { parseJsonObjectBody } from "@/lib/http/validators";
import type { AppraisalInput } from "@/lib/types/appraisal";
import type { RoleType } from "@/lib/chat/types";

/**
 * POST /api/appraisal/generate
 * Staff/developer endpoint for generating structured appraisal drafts.
 * This response is designed to be stable for future PDF/export mapping.
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
    appraisal_context?: AppraisalInput;
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
      { error: "Invalid request body" },
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
      { error: roleResult.message },
      { status: roleResult.status }
    );
    if (traceMeta) response.headers.set("x-appraisal-trace-id", traceId);
    return response;
  }

  const tenantId = normalizeTenantId(body.tenant_id);
  if (!tenantId) {
    const response = NextResponse.json(
      { error: "tenant_id is required for appraisal generation." },
      { status: 400 }
    );
    if (traceMeta) response.headers.set("x-appraisal-trace-id", traceId);
    return response;
  }

  if (!canRoleGenerateAppraisal(roleResult.role)) {
    if (traceMeta) {
      await writeE2eTraceArtifact({
        meta: traceMeta,
        channel: "appraisal-route",
        trace_id: traceId,
        payload: {
          flow_path: [
            "/api/appraisal/generate POST",
            "role_check_failed_non_staff_block",
          ],
          request: {
            ...body,
            resolved_role: roleResult.role,
          },
          response: {
            status: 403,
            body: {
              error: "Appraisal generation is available only for store staff or developer.",
            },
          },
        },
      });
    }
    const response = NextResponse.json(
      { error: "Appraisal generation is available only for store staff or developer." },
      { status: 403 }
    );
    if (traceMeta) response.headers.set("x-appraisal-trace-id", traceId);
    return response;
  }

  const context =
    body.appraisal_context && typeof body.appraisal_context === "object"
      ? body.appraisal_context
      : {};

  const aiTrace: AppraisalAiTrace = {
    called: false,
    model: process.env.OPENAI_MODEL ?? "gpt-4.1-nano",
    request_payload: null,
    response_status: null,
    response_payload: null,
    parsed_response: null,
    fallback_reason: null,
    error: null,
    incomplete_detected: false,
    retry_attempted: false,
    retry_succeeded: false,
    text_postprocess_applied: false,
  };
  const result = await generateAppraisalDraft(context, aiTrace);
  if (traceMeta) {
    await writeE2eTraceArtifact({
      meta: traceMeta,
      channel: "appraisal-route",
      trace_id: traceId,
      payload: {
        flow_path: ["/api/appraisal/generate POST", "generateAppraisalDraft"],
        request: body,
        ai_trace: {
          called: aiTrace.called,
          model: aiTrace.model,
          request_payload_preview: toAppraisalRequestPayloadPreview(
            aiTrace.request_payload
          ),
          response_status: aiTrace.response_status,
          response_payload_preview: toAppraisalResponsePayloadPreview(
            aiTrace.response_payload
          ),
          parsed_response: aiTrace.parsed_response,
          fallback_reason: aiTrace.fallback_reason,
          error: aiTrace.error,
          incomplete_detected: aiTrace.incomplete_detected,
          retry_attempted: aiTrace.retry_attempted,
          retry_succeeded: aiTrace.retry_succeeded,
          text_postprocess_applied: aiTrace.text_postprocess_applied,
        },
        response: {
          status: 200,
          body: result,
        },
      },
    });
  }
  const response = NextResponse.json(result);
  if (traceMeta) response.headers.set("x-appraisal-trace-id", traceId);
  return response;
}
