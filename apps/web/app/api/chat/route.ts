import { NextResponse } from "next/server";
import { handleGeneralChatTurn } from "@/lib/chat/handlers/general-chat";
import { handleRecommendationTurn } from "@/lib/chat/handlers/recommendation";
import { routeTurnMode } from "@/lib/chat/router";
import {
  getOrCreateSession,
  saveSession,
  SessionTenantMismatchError,
} from "@/lib/chat/session-store";
import { updateRecommendationStateForTurn } from "@/lib/chat/state";
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
  hasTenantId,
  normalizeTenantId,
  requireTenantId,
  resolveAuthoritativeTenantForServer,
} from "@/lib/auth/tenant";
import {
  requireRoleCapabilityOrError,
  resolveApiRoleOrError,
} from "@/lib/http/guards";
import {
  parseJsonObjectBody,
  readTrimmedString,
  validateOptionalObjectField,
} from "@/lib/http/validators";
import { checkRateLimit, chatRateLimit } from "@/lib/rate-limit";
import type {
  ChatTurnRequest,
  RoleType,
  SessionData,
  SessionMessage,
} from "@/lib/chat/types";

const MAX_SESSION_ID_CHARS = 64;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
    if (chatRateLimit) {
      const ip =
        req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
        req.headers.get("x-real-ip") ??
        "unknown";
      const { allowed } = await checkRateLimit(chatRateLimit, `chat:${ip}`);
      if (!allowed) {
        return NextResponse.json(
          {
            error:
              "You've sent a lot of messages. Please wait a moment before continuing.",
          },
          { status: 429 }
        );
      }
    }

    const requestedTraceMeta = parseE2eTraceMeta(req);
    const parsedBody = await parseJsonObjectBody<
      ChatTurnRequest & Record<string, unknown>
    >(req);
    if (!parsedBody.ok) return parsedBody.response;
    const body = parsedBody.body as ChatTurnRequest;

    const userMessage = readTrimmedString(body.message);
    if (!userMessage) {
      return badRequest("Please send a message so I can help.");
    }
    if (userMessage.length > 2000) {
      return badRequest("Message is too long. Please keep it under 2000 characters.");
    }

    const constraintsError = validateOptionalObjectField(
      body.constraints,
      "constraints"
    );
    if (constraintsError) return badRequest(constraintsError);

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

    const withRecommendationState = updateRecommendationStateForTurn(session, {
      message: userMessage,
      constraints: body.constraints,
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
    });
    const effectiveMode = routeDecision.mode;
    const memoryEnabled = process.env.CHAT_MEMORY_V1 !== "0";

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
    if (effectiveMode === "recommendation" && !hasTenantId(tenantId)) {
      return badRequest("tenant_id is required for this inventory-backed request.");
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
      session: nextSession,
      ai_context_packet: aiContextPacket ?? undefined,
      tenant_id: tenantId,
      mode: effectiveMode,
      needs_clarification: routeDecision.needs_clarification,
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

    const assistantTurn: SessionMessage = {
      role: "assistant",
      content: handlerResult.assistant_message,
      created_at: new Date().toISOString(),
    };

    const nextConversationMemory = memoryEnabled
      ? mergeConversationMemory(nextSession.conversation_memory, {
          userMessage: userTurn.content,
          assistantMessage: handlerResult.assistant_message,
          lastUserIntent: responseMode,
        })
      : nextSession.conversation_memory;

    const updatedSession: SessionData = {
      ...nextSession,
      role,
      updated_at: new Date().toISOString(),
      chat_history: trimChatHistory([...nextSession.chat_history, userTurn, assistantTurn]),
      conversation_memory: nextConversationMemory,
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
      response: handlerResult,
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
