import { NextResponse } from "next/server";
import { handleAppraisalTurn } from "@/lib/chat/handlers/appraisal";
import { handleGeneralChatTurn } from "@/lib/chat/handlers/general-chat";
import { handleRecommendationTurn } from "@/lib/chat/handlers/recommendation";
import { routeTurnMode } from "@/lib/chat/router";
import { getOrCreateSession, saveSession } from "@/lib/chat/session-store";
import { updateRecommendationStateForTurn } from "@/lib/chat/state";
import { updateTradeContextForTurn } from "@/lib/chat/trade-context";
import { updateProjectContextForTurn } from "@/lib/chat/project-context";
import { buildPromptLayers } from "@/lib/chat/prompt-builder";
import {
  parseE2eTraceMeta,
  writeE2eTraceArtifact,
} from "@/lib/qa/e2e-trace";
import { badRequest, internalError } from "@/lib/errors/http-errors";
import type {
  ChatTurnRequest,
  RoleType,
  SessionData,
  SessionMessage,
} from "@/lib/chat/types";

/**
 * POST /api/chat
 *
 * This is the single backend entry point for user chat turns.
 * High-level flow:
 * 1) receive user message + session id + role
 * 2) load session (history + recommendation/trade/project context)
 * 3) update turn state from this turn
 * 4) route to mode handler (general chat, recommendation, or appraisal)
 * 5) persist updated session and return response
 */
export async function POST(req: Request) {
  const startedAt = Date.now();
  const flowPath: string[] = [
    "/api/chat POST",
    "getOrCreateSession",
    "updateRecommendationStateForTurn",
    "updateTradeContextForTurn",
    "updateProjectContextForTurn",
    "routeTurnMode",
    "handlerDispatch",
    "saveSession",
  ];

  try {
    const traceMeta = parseE2eTraceMeta(req);
    const body = (await req.json().catch(() => null)) as ChatTurnRequest | null;

    if (!body || typeof body !== "object") {
      return badRequest("Invalid request body");
    }

    const userMessage =
      typeof body.message === "string" ? body.message.trim() : "";
    if (!userMessage) {
      return badRequest("Please send a message so I can help.");
    }
    if (userMessage.length > 2000) {
      return badRequest("Message is too long. Please keep it under 2000 characters.");
    }
    if (
      body.trade_preferences !== undefined &&
      (!body.trade_preferences || typeof body.trade_preferences !== "object")
    ) {
      return badRequest("trade_preferences must be an object when provided.");
    }

    const sessionId =
      typeof body.session_id === "string" && body.session_id.trim()
        ? body.session_id.trim()
        : crypto.randomUUID();

    const role: RoleType = normalizeRole(body.role);
    const session = getOrCreateSession(sessionId, role);
    const tenantId =
      typeof body.tenant_id === "string" && body.tenant_id.trim()
        ? body.tenant_id.trim()
        : null;
    const tradeClientId =
      typeof body.trade_client_id === "string" && body.trade_client_id.trim()
        ? body.trade_client_id.trim()
        : null;

    const userTurn: SessionMessage = {
      role: "user",
      content: userMessage,
      created_at: new Date().toISOString(),
    };

    // Keep recommendation state fresh regardless of which mode this turn routes to.
    const withRecommendationState = updateRecommendationStateForTurn(session, {
      message: userMessage,
      constraints: body.constraints,
    });
    const withTradeContext = updateTradeContextForTurn(withRecommendationState, {
      role,
      tenantId,
      tradeClientId,
      tradePreferences:
        body.trade_preferences && typeof body.trade_preferences === "object"
          ? body.trade_preferences
          : undefined,
    });
    const nextSession = updateProjectContextForTurn(withTradeContext, {
      message: userMessage,
      constraints: body.constraints,
      projectContextOverride:
        body.project_context && typeof body.project_context === "object"
          ? body.project_context
          : undefined,
    });

    const mode = routeTurnMode({
      message: userMessage,
      role,
      recommendation_state: nextSession.recommendation_state,
    });

    const handlerInput = {
      message: userMessage,
      role,
      session: nextSession,
      tenant_id: tenantId,
      appraisal_context:
        body.appraisal_context && typeof body.appraisal_context === "object"
          ? body.appraisal_context
          : undefined,
      mode,
      trace_meta: traceMeta ?? undefined,
    } as const;

    const handlerResult =
      mode === "recommendation"
        ? await handleRecommendationTurn(handlerInput)
        : mode === "appraisal"
          ? role === "store_staff"
            ? await handleAppraisalTurn(handlerInput)
            : {
                mode: "general_chat",
                assistant_message:
                  "Appraisal generation is available only for store staff.",
                notes: "Blocked non-staff appraisal request.",
              }
          : await handleGeneralChatTurn(handlerInput);

    const responseMode =
      handlerResult.mode === "recommendation" ||
      handlerResult.mode === "clarifying_question" ||
      handlerResult.mode === "no_match"
        ? "recommendation"
        : handlerResult.mode === "appraisal"
          ? "appraisal"
          : "general_chat";

    const assistantTurn: SessionMessage = {
      role: "assistant",
      content: handlerResult.assistant_message,
      created_at: new Date().toISOString(),
    };

    const updatedSession: SessionData = {
      ...nextSession,
      role,
      updated_at: new Date().toISOString(),
      chat_history: [...nextSession.chat_history, userTurn, assistantTurn],
    };

    saveSession(updatedSession);

    const promptLayerPreview = buildPromptLayers({
      mode,
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
            tenant_id: tenantId,
            trade_client_id: tradeClientId,
            message: userMessage,
            constraints: body.constraints ?? null,
            trade_preferences: body.trade_preferences ?? null,
            project_context: body.project_context ?? null,
            appraisal_context: body.appraisal_context ?? null,
          },
          routing: {
            mode,
            handler:
              mode === "recommendation"
                ? "handleRecommendationTurn"
                : mode === "appraisal"
                  ? role === "store_staff"
                    ? "handleAppraisalTurn"
                    : "non_staff_appraisal_block"
                  : "handleGeneralChatTurn",
            prompt_layer_preview: promptLayerPreview,
          },
          response: {
            session_id: sessionId,
            role,
            mode: responseMode,
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
      recommendation_state: updatedSession.recommendation_state,
      trade_context: updatedSession.trade_context,
      project_context: updatedSession.project_context,
      response: handlerResult,
    });
    if (traceMeta) {
      response.headers.set("x-chat-route-trace-id", routeTraceId);
    }
    return response;
  } catch {
    return internalError(
      "Unable to process chat turn right now. Please try again.",
      "CHAT_INTERNAL_ERROR"
    );
  }
}

function normalizeRole(value: unknown): RoleType {
  if (
    value === "retail_customer" ||
    value === "trade_client" ||
    value === "store_staff"
  ) {
    return value;
  }

  return "retail_customer";
}
