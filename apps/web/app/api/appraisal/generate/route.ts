import { NextResponse } from "next/server";
import { generateAppraisalDraft } from "@/lib/ai/appraisal";
import {
  parseE2eTraceMeta,
  writeE2eTraceArtifact,
} from "@/lib/qa/e2e-trace";
import { resolveRequestRole } from "@/lib/auth/request-role";
import { canRoleGenerateAppraisal } from "@/lib/auth/policy";
import type { AppraisalInput } from "@/lib/types/appraisal";
import type { RoleType } from "@/lib/chat/types";

/**
 * POST /api/appraisal/generate
 * Staff/developer endpoint for generating structured appraisal drafts.
 * This response is designed to be stable for future PDF/export mapping.
 */
export async function POST(req: Request) {
  const traceMeta = parseE2eTraceMeta(req);
  const traceId = crypto.randomUUID();
  const body = (await req.json().catch(() => null)) as
    | { role?: RoleType; appraisal_context?: AppraisalInput }
    | null;

  if (!body || typeof body !== "object") {
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
    const response = NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    if (traceMeta) response.headers.set("x-appraisal-trace-id", traceId);
    return response;
  }

  const roleResolution = await resolveRequestRole({
    requestedRole: body.role,
    defaultRole: "retail_customer",
  });
  if (roleResolution.mismatch) {
    const response = NextResponse.json(
      { error: "Role mismatch between cookie and request payload." },
      { status: 403 }
    );
    if (traceMeta) response.headers.set("x-appraisal-trace-id", traceId);
    return response;
  }
  if (
    roleResolution.source !== "cookie" &&
    (roleResolution.role === "store_staff" || roleResolution.role === "developer")
  ) {
    const response = NextResponse.json(
      { error: "Privileged roles require a synced role cookie from the UI session." },
      { status: 403 }
    );
    if (traceMeta) response.headers.set("x-appraisal-trace-id", traceId);
    return response;
  }

  if (!canRoleGenerateAppraisal(roleResolution.role)) {
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
            resolved_role: roleResolution.role,
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

  const result = await generateAppraisalDraft(context);
  if (traceMeta) {
    await writeE2eTraceArtifact({
      meta: traceMeta,
      channel: "appraisal-route",
      trace_id: traceId,
      payload: {
        flow_path: ["/api/appraisal/generate POST", "generateAppraisalDraft"],
        request: body,
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
