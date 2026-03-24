import { NextResponse } from "next/server";
import { z } from "zod";
import { handleGeneralChatTurn } from "@/lib/chat/handlers/general-chat";
import { handleRecommendationTurn } from "@/lib/chat/handlers/recommendation";
import { routeTurnMode } from "@/lib/chat/router";
import { parseTurn, type TurnParserTrace } from "@/lib/ai/turn-parser";
import {
  getOrCreateSession,
  saveSession,
  SessionTenantMismatchError,
} from "@/lib/chat/session-store";
import { updateRecommendationStateForTurn } from "@/lib/chat/state";
import { compileTurnPolicy } from "@/lib/chat/policy-compiler";
import { buildPromptLayers } from "@/lib/chat/prompt-builder";
import {
  buildAiContextPacket,
  getAiContextPacketStats,
} from "@/lib/chat/context-packet";
import {
  buildInitialConversationMemory,
  mergeConversationMemory,
  trimChatHistory,
} from "@/lib/chat/memory";
import {
  parseE2eTraceMeta,
  writeE2eTraceArtifact,
} from "@/lib/qa/e2e-trace";
import { badRequest, forbidden, internalError } from "@/lib/errors/http-errors";
import {
  normalizeTenantId,
  requireTenantId,
  resolveAuthoritativeTenantForServer,
} from "@/lib/auth/tenant";
import {
  requireRoleCapabilityOrError,
  resolveApiRoleOrError,
} from "@/lib/http/guards";
import { parseJsonBodyWithSchema } from "@/lib/http/route-validation";
import {
  readTrimmedString,
} from "@/lib/http/validators";
import { CHAT_MEMORY_ENABLED } from "@/lib/config";
import {
  checkRateLimit,
  chatRateLimit,
} from "@/lib/rate-limit";
import type {
  ChatTurnRequest,
  RoleType,
  SessionData,
  SessionMessage,
} from "@/lib/chat/types";

const CHAT_BODY_SCHEMA = z
  .object({
    session_id: z.string().trim().min(1).max(128).optional(),
    role: z.string().optional(),
    user_role: z.string().optional(),
    message: z.string(),
    tenant_id: z.string().trim().min(1).max(128).optional(),
    constraints: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

const MAX_SESSION_ID_CHARS = 64;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ReactionType = "like" | "dismiss" | null;

function normalizeList(values: string[]): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => value.trim().toLowerCase())
        .filter((value) => value.length > 0)
    )
  ).slice(0, 12);
}

function detectReactionType(message: string): ReactionType {
  const text = message.toLowerCase();
  if (
    /\b(don't like|do not like|dislike|hate|pass on|skip this|not this one|too .+ for me|no thanks)\b/.test(
      text
    )
  ) {
    return "dismiss";
  }
  if (
    /\b(i like|i love|love this|keep this|this works|yes this|great option|perfect)\b/.test(
      text
    )
  ) {
    return "like";
  }
  return null;
}

export async function POST(req: Request) {
  const startedAt = Date.now();
  const flowPath: string[] = [
    "/api/chat POST",
    "getOrCreateSession",
    "updateRecommendationStateForTurn",
    "routeTurnMode",
    "handlerDispatch",
    "updateConversationMemory",
    "saveSession",
  ];

  try {
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      req.headers.get("x-real-ip") ??
      "unknown";
    const chatRateLimitResult = await checkRateLimit(chatRateLimit, `chat:${ip}`);
    if (!chatRateLimitResult.allowed) {
      return NextResponse.json(
        {
          error:
            "You've sent a lot of messages. Please wait a moment before continuing.",
        },
        { status: 429 }
      );
    }

    const requestedTraceMeta = parseE2eTraceMeta(req);
    const parsedBody = await parseJsonBodyWithSchema(
      req,
      CHAT_BODY_SCHEMA,
      "Invalid request payload."
    );
    if (!parsedBody.ok) return parsedBody.response;
    const body = parsedBody.value;

    const userMessage = readTrimmedString(body.message);
    if (!userMessage) {
      return badRequest("Please send a message so I can help.");
    }
    if (userMessage.length > 2000) {
      return badRequest("Message is too long. Please keep it under 2000 characters.");
    }

    const sessionIdResult = parseSessionId(body.session_id);
    if (!sessionIdResult.ok) return badRequest(sessionIdResult.error);
    const sessionId = sessionIdResult.value;

    const roleResult = await resolveApiRoleOrError({
      role: body.role,
      user_role: body.user_role,
      defaultRole: "retail_customer",
      requiredCapability: "chat.general",
      capabilityErrorMessage: "This role is not allowed to use chat.",
    });
    if (!roleResult.ok) return roleResult.response;
    const role: RoleType = roleResult.role;
    const traceMeta = requestedTraceMeta;
    const parserTrace: TurnParserTrace = {
      called: false,
      model: "",
      request_payload: null,
      response_status: null,
      response_payload: null,
      parsed: null,
      fallback_reason: null,
      error: null,
      incomplete_detected: false,
      latency_ms: null,
    };

    const requestedTenantId = normalizeTenantId(body.tenant_id);
    const authoritativeTenantId = resolveAuthoritativeTenantForServer({
      requestTenantId: requestedTenantId,
    });

    const session = await getOrCreateSession(sessionId, role, {
      tenantId: authoritativeTenantId,
    });
    const tenantId = session.tenant_id ?? authoritativeTenantId ?? null;

    const userTurn: SessionMessage = {
      role: "user",
      content: userMessage,
      created_at: new Date().toISOString(),
    };

    const parsedTurn = await parseTurn({
      message: userMessage,
      context: {
        last_result_mode: session.recommendation_state.runtime?.last_result_mode ?? null,
        has_recent_recommendations: Boolean(
          session.recommendation_state.runtime?.last_result_mode === "recommendation" ||
            session.recommendation_state.runtime?.last_result_mode === "no_match" ||
            session.recommendation_state.runtime?.last_result_mode === "disambiguation"
        ),
        recently_shown_rugs:
          session.recommendation_state.runtime?.recently_shown_rugs ?? [],
      },
      trace: parserTrace,
    });
    const compiledPolicy = compileTurnPolicy({
      parsedTurn,
      explicitConstraints: body.constraints,
    });
    const sparseCompiledConstraints: ChatTurnRequest["constraints"] =
      compiledPolicy.hard_constraints;

    const withRecommendationState = updateRecommendationStateForTurn(session, {
      message: userMessage,
      constraints: sparseCompiledConstraints,
    });
    const nextSession: SessionData = {
      ...withRecommendationState,
      conversation_memory:
        withRecommendationState.conversation_memory ??
        buildInitialConversationMemory(),
    };

    const routeDecision = routeTurnMode({
      message: userMessage,
      role,
      last_result_mode:
        nextSession.recommendation_state.runtime?.last_result_mode ?? null,
      has_recent_recommendations: Boolean(
        nextSession.recommendation_state.runtime?.last_result_mode ===
          "recommendation" ||
          nextSession.recommendation_state.runtime?.last_result_mode === "no_match" ||
          nextSession.recommendation_state.runtime?.last_result_mode === "disambiguation"
      ),
      parsed_turn: parsedTurn,
    });
    const effectiveMode = routeDecision.mode;
    const memoryEnabled = CHAT_MEMORY_ENABLED;
    const currentNoMatchAttempts = Math.max(
      nextSession.conversation_memory.no_match_attempts ?? 0,
      nextSession.recommendation_state.runtime?.no_match_attempts ?? 0
    );
    const startingNoMatchAttempts =
      routeDecision.rule_id === "EXPLICIT_RECOMMENDATION_REQUEST"
        ? 0
        : currentNoMatchAttempts;
    const sessionForHandler: SessionData = {
      ...nextSession,
      conversation_memory: {
        ...nextSession.conversation_memory,
        no_match_attempts: startingNoMatchAttempts,
      },
    };

    if (effectiveMode === "recommendation") {
      const recommendationCapabilityError = requireRoleCapabilityOrError(
        role,
        "chat.recommend",
        "This role is not allowed to request recommendations."
      );
      if (recommendationCapabilityError) return recommendationCapabilityError;
    }

    if (effectiveMode === "recommendation") {
      const tenantError = requireTenantId(tenantId, "inventory-backed flow");
      if (tenantError) return badRequest(tenantError);
    }

    const turnMessage = userMessage;
    const contextSessionForAi = memoryEnabled
      ? nextSession
      : {
          ...nextSession,
          conversation_memory: buildInitialConversationMemory(),
          chat_history: [],
        };

    const aiContextPacket =
      effectiveMode === "recommendation" || effectiveMode === "general_chat"
        ? buildAiContextPacket({
            session: contextSessionForAi,
            latestUserMessage: turnMessage,
          })
        : null;

    const aiContextPacketStats = aiContextPacket
      ? getAiContextPacketStats(aiContextPacket)
      : null;

    const handlerInput = {
      message: turnMessage,
      role,
      session: sessionForHandler,
      ai_context_packet: aiContextPacket ?? undefined,
      tenant_id: tenantId,
      mode: effectiveMode,
      followup_intent: compiledPolicy.followup_intent,
      needs_clarification: routeDecision.needs_clarification,
      constraint_confidence: compiledPolicy.confidence,
      referenced_rug_id: parsedTurn.referenced_rug_id,
      rug_reference_ambiguous: parsedTurn.rug_reference_ambiguous,
      is_discovery_turn: parsedTurn.mode === "discovery",
      trace_meta: traceMeta ?? undefined,
    } as const;

    const handlerResult =
      effectiveMode === "recommendation"
        ? await handleRecommendationTurn(handlerInput)
        : await handleGeneralChatTurn(handlerInput);

    const responseMode = effectiveMode;
    const fineMode =
      routeDecision.needs_clarification && effectiveMode === "general_chat"
        ? "clarifying_question"
        : handlerResult.mode;
    const publicHandlerResult =
      "runtime_update" in handlerResult
        ? (() => {
            const next = {
              ...handlerResult,
            } as Record<string, unknown>;
            delete next.runtime_update;
            return next;
          })()
        : handlerResult;

    const assistantTurn: SessionMessage = {
      role: "assistant",
      content: handlerResult.assistant_message,
      created_at: new Date().toISOString(),
    };

    const nextConversationMemory = memoryEnabled
      ? mergeConversationMemory(sessionForHandler.conversation_memory, {
          userMessage: userTurn.content,
          assistantMessage: handlerResult.assistant_message,
          lastUserIntent: responseMode,
          noMatchAttempts:
            effectiveMode === "recommendation"
              ? handlerResult.mode === "no_match"
                ? startingNoMatchAttempts + 1
                : 0
              : currentNoMatchAttempts,
          sessionFacts: parsedTurn.session_facts ?? [],
        })
      : nextSession.conversation_memory;

    const previousRuntime = nextSession.recommendation_state.runtime ?? {};
    const runtimeUpdate =
      "runtime_update" in handlerResult ? handlerResult.runtime_update : null;
    const nextRecentlyShownRugs = Array.isArray(runtimeUpdate?.recently_shown_rugs)
      ? runtimeUpdate.recently_shown_rugs
      : previousRuntime.recently_shown_rugs ?? [];
    let nextLikedRugIds = Array.isArray(runtimeUpdate?.liked_rug_ids)
      ? runtimeUpdate.liked_rug_ids
      : previousRuntime.liked_rug_ids ?? [];
    let nextDismissedRugIds = Array.isArray(runtimeUpdate?.dismissed_rug_ids)
      ? runtimeUpdate.dismissed_rug_ids
      : previousRuntime.dismissed_rug_ids ?? [];
    const nextLikedAttributes =
      runtimeUpdate?.liked_attributes ??
      previousRuntime.liked_attributes ?? {
        colors: [],
        styles: [],
        origins: [],
      };

    const reactionType = detectReactionType(userMessage);
    const referencedRugId = parsedTurn.referenced_rug_id ?? null;
    if (referencedRugId && reactionType) {
      if (reactionType === "like") {
        nextLikedRugIds = normalizeList([...nextLikedRugIds, referencedRugId]);
        nextDismissedRugIds = nextDismissedRugIds.filter((id) => id !== referencedRugId);
        const referencedRug = nextRecentlyShownRugs.find((rug) => rug.id === referencedRugId);
        if (referencedRug) {
          nextLikedAttributes.colors = normalizeList([
            ...(nextLikedAttributes.colors ?? []),
            ...(referencedRug.colors ?? []),
          ]).slice(0, 8);
          nextLikedAttributes.styles = normalizeList([
            ...(nextLikedAttributes.styles ?? []),
            referencedRug.style ?? "",
          ]).slice(0, 8);
          nextLikedAttributes.origins = normalizeList([
            ...(nextLikedAttributes.origins ?? []),
            referencedRug.origin ?? "",
          ]).slice(0, 8);
        }
      } else if (reactionType === "dismiss") {
        nextDismissedRugIds = normalizeList([...nextDismissedRugIds, referencedRugId]);
        nextLikedRugIds = nextLikedRugIds.filter((id) => id !== referencedRugId);
      }
    }

    const updatedSession: SessionData = {
      ...nextSession,
      role,
      updated_at: new Date().toISOString(),
      chat_history: trimChatHistory([...nextSession.chat_history, userTurn, assistantTurn]),
      conversation_memory: nextConversationMemory,
      recommendation_state: {
        ...nextSession.recommendation_state,
        runtime: {
          ...(nextSession.recommendation_state.runtime ?? {}),
          last_result_mode:
            handlerResult.mode === "recommendation" ||
            handlerResult.mode === "no_match" ||
            handlerResult.mode === "clarifying_question" ||
            handlerResult.mode === "disambiguation"
              ? handlerResult.mode
              : nextSession.recommendation_state.runtime?.last_result_mode,
          last_relaxed_size_tolerance_in:
            "runtime_update" in handlerResult &&
            handlerResult.runtime_update &&
            Object.prototype.hasOwnProperty.call(
              handlerResult.runtime_update,
              "relaxed_size_tolerance_in"
            )
              ? handlerResult.runtime_update.relaxed_size_tolerance_in ?? null
              : nextSession.recommendation_state.runtime
                    ?.last_relaxed_size_tolerance_in ?? null,
          last_blockers:
            "runtime_update" in handlerResult &&
            handlerResult.runtime_update?.blockers
              ? handlerResult.runtime_update.blockers
              : nextSession.recommendation_state.runtime?.last_blockers ?? [],
          last_recommended_size_in:
            "runtime_update" in handlerResult &&
            handlerResult.runtime_update &&
            Object.prototype.hasOwnProperty.call(
              handlerResult.runtime_update,
              "last_recommended_size_in"
            ) &&
            handlerResult.runtime_update.last_recommended_size_in
              ? handlerResult.runtime_update.last_recommended_size_in
              : nextSession.recommendation_state.runtime
                    ?.last_recommended_size_in ?? null,
          liked_rug_ids:
            nextLikedRugIds,
          dismissed_rug_ids:
            nextDismissedRugIds,
          liked_attributes:
            {
              colors: normalizeList(nextLikedAttributes.colors ?? []).slice(0, 8),
              styles: normalizeList(nextLikedAttributes.styles ?? []).slice(0, 8),
              origins: normalizeList(nextLikedAttributes.origins ?? []).slice(0, 8),
            },
          recently_shown_rugs:
            nextRecentlyShownRugs,
          no_match_attempts:
            effectiveMode === "recommendation"
              ? handlerResult.mode === "no_match"
                ? startingNoMatchAttempts + 1
                : 0
              : currentNoMatchAttempts,
          updated_at: new Date().toISOString(),
        },
      },
    };

    await saveSession(updatedSession, {
      tenantId,
      mode: responseMode,
      turns: [userTurn, assistantTurn],
    });

    const promptLayerPreview = buildPromptLayers({
      mode: effectiveMode,
      role,
      session: nextSession,
      userMessage,
    });

    const routeTraceId = crypto.randomUUID();
    if (traceMeta) {
      await writeE2eTraceArtifact({
        meta: traceMeta,
        channel: "chat-route",
        trace_id: routeTraceId,
        payload: {
          flow_path: flowPath,
          request: {
            session_id: body.session_id ?? null,
            role,
            requested_tenant_id: requestedTenantId,
            tenant_id: tenantId,
            message: userMessage,
            constraints: body.constraints ?? null,
          },
          routing: {
            mode: effectiveMode,
            rule_id: routeDecision.rule_id,
            confidence: routeDecision.confidence,
            needs_clarification: routeDecision.needs_clarification,
            parser_trace: {
              called: parserTrace.called,
              model: parserTrace.model,
              response_status: parserTrace.response_status,
              fallback_reason: parserTrace.fallback_reason,
              incomplete_detected: parserTrace.incomplete_detected,
              latency_ms: parserTrace.latency_ms,
              parsed: parserTrace.parsed,
              error: parserTrace.error,
            },
            compiled_policy: compiledPolicy,
            handler:
              effectiveMode === "recommendation"
                ? "handleRecommendationTurn"
                : "handleGeneralChatTurn",
            prompt_layer_preview: promptLayerPreview,
          },
          state_snapshot: {
            recommendation_state: nextSession.recommendation_state,
            conversation_memory: nextSession.conversation_memory,
          },
          memory_snapshot_before: nextSession.conversation_memory,
          memory_snapshot_after: updatedSession.conversation_memory,
          ai_context_packet_stats: aiContextPacketStats,
          response: {
            session_id: sessionId,
            role,
            mode: responseMode,
            fine_mode: fineMode,
            response_mode: handlerResult.mode,
            notes: handlerResult.notes ?? null,
          },
          timing_ms: {
            total_ms: Date.now() - startedAt,
          },
        },
      });
    }

    const response = NextResponse.json({
      session_id: sessionId,
      role,
      mode: responseMode,
      fine_mode: fineMode,
      recommendation_state: updatedSession.recommendation_state,
      response: publicHandlerResult,
    });
    if (traceMeta) {
      response.headers.set("x-chat-route-trace-id", routeTraceId);
    }
    return response;
  } catch (error) {
    if (error instanceof SessionTenantMismatchError) {
      return forbidden("tenant_id does not match the existing session tenant.");
    }
    return internalError(
      "Unable to process chat turn right now. Please try again.",
      "CHAT_INTERNAL_ERROR"
    );
  }
}

function parseSessionId(
  value: unknown
): { ok: true; value: string } | { ok: false; error: string } {
  if (value === undefined || value === null) {
    return { ok: true, value: crypto.randomUUID() };
  }
  if (typeof value !== "string") {
    return { ok: false, error: "session_id must be a UUID string when provided." };
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return { ok: true, value: crypto.randomUUID() };
  }
  if (trimmed.length > MAX_SESSION_ID_CHARS) {
    return {
      ok: false,
      error: `session_id is too long. Keep it under ${MAX_SESSION_ID_CHARS} characters.`,
    };
  }
  if (!UUID_PATTERN.test(trimmed)) {
    return { ok: false, error: "session_id must be a valid UUID." };
  }

  return { ok: true, value: trimmed };
}
