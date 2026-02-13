import { NextResponse } from "next/server";
import { handleGeneralChatTurn } from "@/lib/chat/handlers/general-chat";
import { handleRecommendationTurn } from "@/lib/chat/handlers/recommendation";
import { routeTurnMode } from "@/lib/chat/router";
import { getOrCreateSession, saveSession } from "@/lib/chat/session-store";
import { updateRecommendationStateForTurn } from "@/lib/chat/state";
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
 * 2) load session (history + recommendation state)
 * 3) update recommendation state from this turn
 * 4) route to mode handler (general chat or recommendation)
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

  const userTurn: SessionMessage = {
    role: "user",
    content: userMessage,
    created_at: new Date().toISOString(),
  };

  // Keep recommendation state fresh regardless of which mode this turn routes to.
  const nextSession = updateRecommendationStateForTurn(session, {
    message: userMessage,
    constraints: body.constraints,
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
    inventory: Array.isArray(body.inventory) ? body.inventory : [],
    mode,
  } as const;

  const handlerResult =
    mode === "recommendation"
      ? await handleRecommendationTurn(handlerInput)
      : await handleGeneralChatTurn(handlerInput);

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
    mode,
    recommendation_state: updatedSession.recommendation_state,
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

