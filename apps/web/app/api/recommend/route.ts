import { NextResponse } from "next/server";
import { z } from "zod";
import {
  extractConstraintsFromUserMessage,
  mergeHardConstraints,
  normalizeHardConstraints,
} from "@/lib/filters/extract-constraints";
import { runRecommendationPipeline } from "@/lib/recommend/pipeline";
import { parseRecommendationFollowupIntent } from "@/lib/chat/router";
import {
  parseE2eTraceMeta,
  writeE2eTraceArtifact,
} from "@/lib/qa/e2e-trace";
import { badRequest, internalError } from "@/lib/errors/http-errors";
import {
  hasTenantId,
  normalizeTenantId,
  requireTenantId,
  resolveAuthoritativeTenantForServer,
} from "@/lib/auth/tenant";
import { resolveApiRoleOrError } from "@/lib/http/guards";
import { parseJsonBodyWithSchema } from "@/lib/http/route-validation";
import {
  readUserMessage,
} from "@/lib/http/validators";
import {
  checkLocalRateLimit,
  checkRateLimit,
  recommendRateLimit,
} from "@/lib/rate-limit";
import type { HardConstraints } from "@/lib/types/recommendation";

const RECOMMEND_BODY_SCHEMA = z
  .object({
    tenant_id: z.string().trim().min(1).max(128).optional(),
    role: z.string().optional(),
    user_role: z.string().optional(),
    user_message: z.string().optional(),
    message: z.string().optional(),
    constraints: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

function hasMeaningfulConstraints(constraints: HardConstraints): boolean {
  return (
    Boolean(
      constraints.size &&
        typeof constraints.size.widthIn === "number" &&
        typeof constraints.size.lengthIn === "number"
    ) ||
    Boolean(constraints.colors && constraints.colors.length > 0) ||
    Boolean(constraints.styles && constraints.styles.length > 0) ||
    Boolean(constraints.shape)
  );
}

/**
 * POST /api/recommend
 * Recommendation-mode route only.
 * Input: optional `constraints`, optional `user_message`/`message`, and required `tenant_id`.
 * Behavior: query Supabase with active hard constraints first, run backend hard checks, then ask AI to rank/explain.
 * Not for freeform chat; inventory truth stays in backend.
 */

// Flow overview
// 1) Parse request body and extract constraints + user message.
// 2) Normalize explicit constraints and parse lightweight constraints from user text.
// 3) Merge both sources into one backend constraint object.
// 4) Query Supabase for coarse candidate set (SQL-first hard filtering).
// 5) Apply deterministic hard-constraint filtering in backend code.
// 6) Shape candidates (bounded deterministic order) before AI ranking.
// 7) Return structured JSON for UI.

export async function POST(req: Request) {
  const startedAt = Date.now();
  try {
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      req.headers.get("x-real-ip") ??
      "unknown";
    const recommendRateLimitResult = recommendRateLimit
      ? await checkRateLimit(recommendRateLimit, `recommend:${ip}`)
      : checkLocalRateLimit({
          key: `recommend:${ip}`,
          maxRequests: 30,
          windowMs: 10 * 60 * 1000,
        });
    if (!recommendRateLimitResult.allowed) {
      return NextResponse.json(
        {
          error:
            "You have sent many recommendation requests. Please wait a moment and try again.",
        },
        { status: 429 }
      );
    }

    const requestId = crypto.randomUUID();
    const traceMeta = parseE2eTraceMeta(req);
    const routeTraceId = crypto.randomUUID();

    const parsedBody = await parseJsonBodyWithSchema(
      req,
      RECOMMEND_BODY_SCHEMA,
      "Invalid request"
    );
    if (!parsedBody.ok) {
      if (traceMeta) {
        await writeE2eTraceArtifact({
          meta: traceMeta,
          channel: "recommend-route",
          trace_id: routeTraceId,
          payload: {
            flow_path: ["/api/recommend POST", "request_validation_failed"],
            request_id: requestId,
            request: null,
            response: {
              status: 400,
              body: { error: "Invalid request", code: "BAD_REQUEST" },
            },
            timing_ms: {
              total_ms: Date.now() - startedAt,
            },
          },
        });
      }
      return parsedBody.response;
    }
    const body = parsedBody.value;

    const roleResult = await resolveApiRoleOrError({
      role: body.role,
      user_role: body.user_role,
      defaultRole: "retail_customer",
      requiredCapability: "chat.recommend",
      capabilityErrorMessage: "This role is not allowed to request recommendations.",
    });
    if (!roleResult.ok) {
      if (traceMeta) {
        await writeE2eTraceArtifact({
          meta: traceMeta,
          channel: "recommend-route",
          trace_id: routeTraceId,
          payload: {
            flow_path: ["/api/recommend POST", "request_validation_failed"],
            request_id: requestId,
            request: null,
            response: {
              status: roleResult.response.status,
              body: {
                error: "Role validation failed.",
                code:
                  roleResult.response.status === 400 ? "BAD_REQUEST" : "FORBIDDEN",
              },
            },
            timing_ms: {
              total_ms: Date.now() - startedAt,
            },
          },
        });
      }
      return roleResult.response;
    }

    // `user_message` is preferred, but we also accept `message`.
    const userMessage = readUserMessage(body);

    // Explicit request constraints come from UI payload.
    const explicitConstraints = normalizeHardConstraints(body.constraints);
    // Inferred constraints come from lightweight text parsing (e.g. "8x10-ish").
    const inferredConstraints = extractConstraintsFromUserMessage(userMessage);
    // Explicit values win when both sources are present.
    const constraints: HardConstraints = mergeHardConstraints(
      explicitConstraints,
      inferredConstraints
    );

    if (!userMessage && !hasMeaningfulConstraints(constraints)) {
      if (traceMeta) {
        await writeE2eTraceArtifact({
          meta: traceMeta,
          channel: "recommend-route",
          trace_id: routeTraceId,
          payload: {
            flow_path: ["/api/recommend POST", "request_validation_failed"],
            request_id: requestId,
            request: {
              tenant_id: body.tenant_id ?? null,
              user_message: userMessage,
              constraints,
            },
            response: {
              status: 400,
              body: {
                  error:
                    "Provide a message or at least one valid hard constraint.",
                code: "BAD_REQUEST",
              },
            },
            timing_ms: {
              total_ms: Date.now() - startedAt,
            },
          },
        });
      }
      return badRequest(
        "Provide a message or at least one valid hard constraint."
      );
    }

    if (constraints.size) {
      const { widthIn, lengthIn, toleranceIn } = constraints.size;
      if (
        !Number.isFinite(widthIn) ||
        !Number.isFinite(lengthIn) ||
        widthIn <= 0 ||
        lengthIn <= 0
      ) {
        if (traceMeta) {
          await writeE2eTraceArtifact({
            meta: traceMeta,
            channel: "recommend-route",
            trace_id: routeTraceId,
            payload: {
              flow_path: ["/api/recommend POST", "request_validation_failed"],
              request_id: requestId,
              request: {
                tenant_id: body.tenant_id ?? null,
                user_message: userMessage,
                constraints,
              },
              response: {
                status: 400,
                body: {
                  error: "size widthIn/lengthIn must be positive numbers.",
                  code: "BAD_REQUEST",
                },
              },
              timing_ms: {
                total_ms: Date.now() - startedAt,
              },
            },
          });
        }
        return badRequest("size widthIn/lengthIn must be positive numbers.");
      }
      if (
        toleranceIn !== undefined &&
        (!Number.isFinite(toleranceIn) || toleranceIn < 0)
      ) {
        if (traceMeta) {
          await writeE2eTraceArtifact({
            meta: traceMeta,
            channel: "recommend-route",
            trace_id: routeTraceId,
            payload: {
              flow_path: ["/api/recommend POST", "request_validation_failed"],
              request_id: requestId,
              request: {
                tenant_id: body.tenant_id ?? null,
                user_message: userMessage,
                constraints,
              },
              response: {
                status: 400,
                body: {
                  error: "size toleranceIn must be zero or a positive number.",
                  code: "BAD_REQUEST",
                },
              },
              timing_ms: {
                total_ms: Date.now() - startedAt,
              },
            },
          });
        }
        return badRequest("size toleranceIn must be zero or a positive number.");
      }
    }

    const tenantId = resolveAuthoritativeTenantForServer({
      requestTenantId: normalizeTenantId(body.tenant_id),
    });
    const tenantError = requireTenantId(tenantId, "recommendation");
    if (tenantError) {
      if (traceMeta) {
        await writeE2eTraceArtifact({
          meta: traceMeta,
          channel: "recommend-route",
          trace_id: routeTraceId,
          payload: {
            flow_path: ["/api/recommend POST", "request_validation_failed"],
            request_id: requestId,
            request: {
              tenant_id: body.tenant_id ?? null,
              user_message: userMessage,
              constraints,
            },
            response: {
              status: 400,
              body: {
                error: tenantError,
                code: "BAD_REQUEST",
              },
            },
            timing_ms: {
              total_ms: Date.now() - startedAt,
            },
          },
        });
      }
      return badRequest(tenantError);
    }

    if (!hasTenantId(tenantId)) {
      return badRequest("tenant_id is required for recommendation requests.");
    }

    const result = await runRecommendationPipeline({
      requestId,
      tenantId,
      userMessage,
      constraints,
      followupIntent: parseRecommendationFollowupIntent(
        userMessage.toLowerCase().trim()
      ),
      priorResultMode: null,
      promptContext: undefined,
      traceMeta: traceMeta
        ? {
            ...traceMeta,
            source_route: "/api/recommend",
            session_id: null,
            role: null,
          }
        : undefined,
    });

    if (!result.ok) {
      if (traceMeta) {
        await writeE2eTraceArtifact({
          meta: traceMeta,
          channel: "recommend-route",
          trace_id: routeTraceId,
          payload: {
            flow_path: [
              "/api/recommend POST",
              "runRecommendationPipeline",
              "pipeline_failure",
            ],
            request_id: requestId,
            request: {
              tenant_id: tenantId,
              user_message: userMessage,
              constraints,
            },
            response: {
              status: 500,
              body: {
                error: "Unable to run recommendation pipeline right now.",
                code: "RECOMMENDATION_PIPELINE_ERROR",
              },
            },
            timing_ms: {
              total_ms: Date.now() - startedAt,
            },
          },
        });
      }
      return internalError(
        "Unable to run recommendation pipeline right now.",
        "RECOMMENDATION_PIPELINE_ERROR"
      );
    }

    if (traceMeta) {
      await writeE2eTraceArtifact({
        meta: traceMeta,
        channel: "recommend-route",
        trace_id: routeTraceId,
        payload: {
          flow_path: ["/api/recommend POST", "runRecommendationPipeline"],
          request_id: requestId,
          request: {
            tenant_id: tenantId,
            user_message: userMessage,
            constraints,
          },
          response: {
            status: 200,
            body: {
              mode: result.response.mode,
              notes: result.response.notes,
              recommendation_count: result.response.recommendations.length,
            },
            pipeline_trace_id: result.trace_id ?? null,
          },
          timing_ms: {
            total_ms: Date.now() - startedAt,
          },
        },
      });
    }

    const response = NextResponse.json(result.response);
    if (result.trace_id) {
      response.headers.set("x-recommendation-trace-id", result.trace_id);
    }
    if (traceMeta) {
      response.headers.set("x-recommend-route-trace-id", routeTraceId);
    }
    return response;
  } catch {
    return internalError(
      "Unable to run recommendation pipeline right now.",
      "RECOMMENDATION_PIPELINE_ERROR"
    );
  }
}
