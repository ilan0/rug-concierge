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
  RecommendationReviewAction,
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
    const reviewAction = normalizeReviewAction(body.review_action);
    const hasMessage = userMessage.length > 0;
    if (!hasMessage && !reviewAction) {
      return badRequest("Please send a message so I can help.");
    }
    if (hasMessage && userMessage.length > 2000) {
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
    if (reviewAction && role !== "store_staff") {
      return badRequest("review_action is available only for store_staff role.");
    }
    if (
      reviewAction === "override" &&
      body.override !== undefined &&
      (typeof body.override !== "object" || body.override === null)
    ) {
      return badRequest("override must be an object when provided.");
    }
    if (
      body.override?.selected_rug_ids !== undefined &&
      !Array.isArray(body.override.selected_rug_ids)
    ) {
      return badRequest("override.selected_rug_ids must be an array when provided.");
    }
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
      content: hasMessage ? userMessage : `[review_action:${reviewAction}]`,
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

    const routeDecision = routeTurnMode({
      message: userMessage,
      role,
      review_action: reviewAction,
      last_mode:
        nextSession.review_state.last_mode === "recommendations"
          ? "recommendation"
          : "general_chat",
      has_recent_recommendations: nextSession.review_state.last_recommendations.length > 0,
      recommendation_state: nextSession.recommendation_state,
    });
    const effectiveMode = routeDecision.mode;

    const handlerInput = {
      message:
        userMessage ||
        nextSession.review_state.last_user_message ||
        "Show me another recommendation set.",
      role,
      session: nextSession,
      tenant_id: tenantId,
      appraisal_context:
        body.appraisal_context && typeof body.appraisal_context === "object"
          ? body.appraisal_context
          : undefined,
      mode: effectiveMode,
      review_action: reviewAction,
      override:
        body.override && typeof body.override === "object"
          ? {
              assistant_message:
                typeof body.override.assistant_message === "string"
                  ? body.override.assistant_message
                  : undefined,
              selected_rug_ids: Array.isArray(body.override.selected_rug_ids)
                ? body.override.selected_rug_ids.filter(
                    (id): id is string => typeof id === "string" && id.trim().length > 0
                  )
                : undefined,
              notes:
                typeof body.override.notes === "string"
                  ? body.override.notes
                  : undefined,
            }
          : undefined,
      trace_meta: traceMeta ?? undefined,
    } as const;

    const handlerResult =
      routeDecision.rule_id === "APPRAISAL_NON_STAFF_BLOCK"
        ? {
            mode: "general_chat",
            assistant_message:
              "Appraisal generation is available only for store staff.",
            notes: "Blocked non-staff appraisal request.",
          }
        : routeDecision.needs_clarification
          ? {
              mode: "general_chat",
              assistant_message:
                "Do you want me to show inventory options, or are you asking for general rug advice?",
              notes: "ROUTER_CLARIFICATION_REQUIRED",
            }
          : effectiveMode === "recommendation"
            ? await handleRecommendationTurn(handlerInput)
            : effectiveMode === "appraisal"
              ? await handleAppraisalTurn(handlerInput)
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
      review_state:
        responseMode === "recommendation"
          ? updateReviewState(nextSession, {
              role,
              userMessage:
                userMessage ||
                nextSession.review_state.last_user_message ||
                "Show me another recommendation set.",
              reviewAction,
              overrideNotes:
                typeof body.override?.notes === "string"
                  ? body.override.notes.trim()
                  : null,
              responseMode: handlerResult.mode,
              assistantMessage: handlerResult.assistant_message,
              recommendations:
                "recommendations" in handlerResult
                  ? handlerResult.recommendations
                  : [],
              questions:
                "questions" in handlerResult ? handlerResult.questions : [],
              notes: handlerResult.notes ?? null,
            })
          : nextSession.review_state,
    };

    saveSession(updatedSession);

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
            tenant_id: tenantId,
            trade_client_id: tradeClientId,
            message: userMessage,
            constraints: body.constraints ?? null,
            trade_preferences: body.trade_preferences ?? null,
            project_context: body.project_context ?? null,
            appraisal_context: body.appraisal_context ?? null,
            review_action: reviewAction,
            override: body.override ?? null,
          },
          routing: {
            mode: effectiveMode,
            rule_id: routeDecision.rule_id,
            confidence: routeDecision.confidence,
            needs_clarification: routeDecision.needs_clarification,
            handler:
              effectiveMode === "recommendation"
                ? "handleRecommendationTurn"
                : effectiveMode === "appraisal"
                  ? role === "store_staff"
                    ? "handleAppraisalTurn"
                    : "non_staff_appraisal_block"
                  : "handleGeneralChatTurn",
            prompt_layer_preview: promptLayerPreview,
          },
          state_snapshot: {
            recommendation_state: nextSession.recommendation_state,
            trade_context: nextSession.trade_context,
            project_context: nextSession.project_context,
            review_state: nextSession.review_state,
          },
          response: {
            session_id: sessionId,
            role,
            mode: responseMode,
            response_mode: handlerResult.mode,
            review_action: reviewAction,
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
      review_state: updatedSession.review_state,
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

function normalizeReviewAction(value: unknown): RecommendationReviewAction | null {
  if (
    value === "approve" ||
    value === "reject" ||
    value === "regenerate" ||
    value === "override"
  ) {
    return value;
  }
  return null;
}

function updateReviewState(
  session: SessionData,
  input: {
    role: RoleType;
    userMessage: string;
    reviewAction: RecommendationReviewAction | null;
    overrideNotes: string | null;
    responseMode: "recommendation" | "clarifying_question" | "no_match";
    assistantMessage: string;
    recommendations: SessionData["review_state"]["last_recommendations"];
    questions: string[];
    notes: string | null;
  }
): SessionData["review_state"] {
  const now = new Date().toISOString();
  const prior = session.review_state;
  const decision =
    input.reviewAction === "approve"
      ? "approved"
      : input.reviewAction === "reject"
        ? "rejected"
        : input.reviewAction === "override"
          ? "overridden"
          : input.reviewAction === "regenerate"
            ? "regenerated"
            : "none";

  return {
    ...prior,
    last_user_message: input.userMessage,
    last_assistant_message: input.assistantMessage,
    last_recommendations: input.recommendations,
    last_questions: input.questions,
    last_mode: input.responseMode,
    last_notes: input.notes,
    decision,
    decision_notes: input.overrideNotes,
    decision_at: input.reviewAction ? now : prior.decision_at,
    reviewed_by_role: input.reviewAction ? input.role : prior.reviewed_by_role,
    regenerate_count:
      prior.regenerate_count + (input.reviewAction === "regenerate" ? 1 : 0),
    override_count: prior.override_count + (input.reviewAction === "override" ? 1 : 0),
  };
}
