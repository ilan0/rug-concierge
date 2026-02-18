import { NextResponse } from "next/server";
import { handleAppraisalTurn } from "@/lib/chat/handlers/appraisal";
import { handleGeneralChatTurn } from "@/lib/chat/handlers/general-chat";
import { handleRecommendationTurn } from "@/lib/chat/handlers/recommendation";
import { routeTurnMode } from "@/lib/chat/router";
import { getOrCreateSession, saveSession } from "@/lib/chat/session-store";
import { updateRecommendationStateForTurn } from "@/lib/chat/state";
import { updateTradeContextForTurn } from "@/lib/chat/trade-context";
import { updateProjectContextForTurn } from "@/lib/chat/project-context";
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
  const body = (await req.json().catch(() => null)) as ChatTurnRequest | null;

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const userMessage = typeof body.message === "string" ? body.message.trim() : "";
  if (!userMessage) {
    return NextResponse.json({ error: "Missing message" }, { status: 400 });
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

  return NextResponse.json({
    session_id: sessionId,
    role,
    mode: responseMode,
    recommendation_state: updatedSession.recommendation_state,
    trade_context: updatedSession.trade_context,
    project_context: updatedSession.project_context,
    response: handlerResult,
  });
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
