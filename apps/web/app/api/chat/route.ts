import { NextResponse } from "next/server";
import { z } from "zod";
import { handleGeneralChatTurn } from "@/lib/chat/handlers/general-chat";
import { handleRecommendationTurn } from "@/lib/chat/handlers/recommendation";
import { streamGeneralChatMessage } from "@/lib/ai/general-chat";
import { routeTurnMode } from "@/lib/chat/router";
import { parseTurn, type TurnParserTrace } from "@/lib/ai/turn-parser";
import { detectResponseLanguage } from "@/lib/ai/language";
import {
  getOrCreateSession,
  saveSession,
  SessionTenantMismatchError,
} from "@/lib/chat/session-store";
import { compileTurnPolicy } from "@/lib/chat/policy-compiler";
import { buildPromptLayers } from "@/lib/chat/prompt-builder";
import {
  buildAiContextPacket,
  getAiContextPacketStats,
} from "@/lib/chat/context-packet";
import {
  buildInitialConversationMemory,
  extractStableFactsFromUserMessage,
  mergeConversationMemory,
  trimChatHistory,
} from "@/lib/chat/memory";
import {
  parseE2eTraceMeta,
  writeE2eTraceArtifact,
} from "@/lib/qa/e2e-trace";
import { badRequest, forbidden, internalError } from "@/lib/errors/http-errors";
import {
  resolveTenantFromRequest,
} from "@/lib/tenant/resolve-tenant";
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

function hasSpanishSignal(text: string): boolean {
  return /[¿¡]|[áéíóúñ]|\b(puedo|mostrar|coleccion|colección|opciones|si|quieres|alfombra|estilo|aqui|aquí|para)\b/i.test(
    text
  );
}

function enforceAssistantLanguageMatch(input: {
  userMessage: string;
  assistantMessage: string;
}): string {
  if (detectResponseLanguage(input.userMessage) !== "es") {
    return input.assistantMessage;
  }
  if (hasSpanishSignal(input.assistantMessage)) {
    return input.assistantMessage;
  }
  return `Aqui tienes opciones de la coleccion en ese estilo. ${input.assistantMessage}`.trim();
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
    const requestedTraceMeta = parseE2eTraceMeta(req);
    const requestedTraceRunHeader =
      req.headers.get("x-e2e-trace-run")?.trim() ?? "";
    const isLocalE2eTraceRun =
      process.env.E2E_TRACE_BYPASS_RATE_LIMIT === "1" &&
      requestedTraceRunHeader.length > 0;
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      req.headers.get("x-real-ip") ??
      "unknown";
    if (!isLocalE2eTraceRun) {
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
    }
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

    const tenantResolution = await resolveTenantFromRequest(req);
    if (!tenantResolution.ok) {
      return NextResponse.json(
        {
          error: tenantResolution.message,
          code:
            tenantResolution.status === 404
              ? "TENANT_NOT_FOUND"
              : "TENANT_RESOLUTION_FAILED",
        },
        { status: tenantResolution.status }
      );
    }

    const session = await getOrCreateSession(sessionId, role, {
      tenantId: tenantResolution.tenantId,
    });
    const tenantId = session.tenant_id ?? tenantResolution.tenantId;

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
      message: userMessage,
      explicitConstraints: body.constraints,
      previousConstraints: session.recommendation_state.hard_constraints,
    });
    const nextSession: SessionData = {
      ...session,
      recommendation_state: {
        ...session.recommendation_state,
        hard_constraints: compiledPolicy.persisted_hard_constraints,
      },
      conversation_memory:
        session.conversation_memory ??
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
    const runtimeBeforeHandler = sessionForHandler.recommendation_state.runtime ?? {};
    const immediateReactionType = detectReactionType(userMessage);
    const immediateReferencedRugId = parsedTurn.referenced_rug_id ?? null;
    let preHandlerLikedRugIds = normalizeList(runtimeBeforeHandler.liked_rug_ids ?? []).slice(
      0,
      12
    );
    let preHandlerDismissedRugIds = normalizeList(
      runtimeBeforeHandler.dismissed_rug_ids ?? []
    ).slice(0, 12);
    const preHandlerLikedAttributes = {
      colors: normalizeList(runtimeBeforeHandler.liked_attributes?.colors ?? []).slice(0, 8),
      styles: normalizeList(runtimeBeforeHandler.liked_attributes?.styles ?? []).slice(0, 8),
      origins: normalizeList(runtimeBeforeHandler.liked_attributes?.origins ?? []).slice(0, 8),
    };
    if (immediateReactionType && immediateReferencedRugId) {
      if (immediateReactionType === "like") {
        preHandlerLikedRugIds = normalizeList([
          ...preHandlerLikedRugIds,
          immediateReferencedRugId,
        ]).slice(0, 12);
        preHandlerDismissedRugIds = preHandlerDismissedRugIds.filter(
          (id) => id !== immediateReferencedRugId
        );
        const referencedRug = (runtimeBeforeHandler.recently_shown_rugs ?? []).find(
          (rug) => rug.id === immediateReferencedRugId
        );
        if (referencedRug) {
          preHandlerLikedAttributes.colors = normalizeList([
            ...preHandlerLikedAttributes.colors,
            ...(referencedRug.colors ?? []),
          ]).slice(0, 8);
          preHandlerLikedAttributes.styles = normalizeList([
            ...preHandlerLikedAttributes.styles,
            referencedRug.style ?? "",
          ]).slice(0, 8);
          preHandlerLikedAttributes.origins = normalizeList([
            ...preHandlerLikedAttributes.origins,
            referencedRug.origin ?? "",
          ]).slice(0, 8);
        }
      } else if (immediateReactionType === "dismiss") {
        preHandlerDismissedRugIds = normalizeList([
          ...preHandlerDismissedRugIds,
          immediateReferencedRugId,
        ]).slice(0, 12);
        preHandlerLikedRugIds = preHandlerLikedRugIds.filter(
          (id) => id !== immediateReferencedRugId
        );
      }
    }
    const sessionForHandlerWithReaction: SessionData = {
      ...sessionForHandler,
      recommendation_state: {
        ...sessionForHandler.recommendation_state,
        runtime: {
          ...runtimeBeforeHandler,
          liked_rug_ids: preHandlerLikedRugIds,
          dismissed_rug_ids: preHandlerDismissedRugIds,
          liked_attributes: preHandlerLikedAttributes,
        },
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

    const turnMessage = userMessage;
    const contextSessionForAi = memoryEnabled
      ? sessionForHandlerWithReaction
      : {
          ...sessionForHandlerWithReaction,
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
      session: sessionForHandlerWithReaction,
      ai_context_packet: aiContextPacket ?? undefined,
      tenant_id: tenantId,
      mode: effectiveMode,
      followup_intent: compiledPolicy.followup_intent,
      needs_clarification: routeDecision.needs_clarification,
      constraint_confidence: compiledPolicy.confidence,
      referenced_rug_id: parsedTurn.referenced_rug_id,
      rug_reference_ambiguous: parsedTurn.rug_reference_ambiguous,
      is_discovery_turn: compiledPolicy.discovery_requested,
      parsed_intent: parsedTurn.intent,
      trace_meta: traceMeta ?? undefined,
    } as const;

    // ── SSE infrastructure ────────────────────────────────────────────────────
    const encoder = new TextEncoder();
    const sseEvent = (event: string, data: unknown): Uint8Array =>
      encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

    const routeTraceId = crypto.randomUUID();

    // Return the SSE response *immediately* so the browser gets headers and the
    // connection is open before any AI call begins.  All handler dispatch, state
    // building, and session persistence happen inside start() below.
    const stream = new ReadableStream({
      async start(controller) {
        let updatedSession: SessionData | null = null;
        try {
          // ── 1. Dispatch handler (or stream directly for general chat) ────────
          let handlerResult: Awaited<ReturnType<typeof handleGeneralChatTurn>> | Awaited<ReturnType<typeof handleRecommendationTurn>>;

          if (effectiveMode === "general_chat") {
            // True streaming: pipe Chat Completions tokens directly to the SSE
            // channel.  First token arrives in ~500 ms instead of 4–6 s.
            const contextPacket =
              handlerInput.ai_context_packet ??
              buildAiContextPacket({
                session: handlerInput.session,
                latestUserMessage: handlerInput.message,
              });

            const streamedResponse = await streamGeneralChatMessage({
              role: handlerInput.role,
              contextPacket,
              forceClarification: Boolean(handlerInput.needs_clarification),
              onChunk: (chunk) => {
                try {
                  controller.enqueue(sseEvent("text", chunk));
                } catch { /* stream already closed */ }
              },
            });

            // Build a GeneralChatResponse-compatible object from the streamed result.
            handlerResult = {
              mode: handlerInput.needs_clarification
                ? "clarifying_question"
                : "general_chat",
              assistant_message: streamedResponse.assistant_message,
              notes: streamedResponse.notes ?? "GENERAL_CHAT_AI_RUNTIME:real:streamed",
            } as Awaited<ReturnType<typeof handleGeneralChatTurn>>;
          } else {
            // Recommendation: run the full pipeline (blocking).
            // The SSE response headers are already sent, so the browser shows
            // a loading skeleton while we wait.  Text streams after the pipeline
            // completes.
            handlerResult = await handleRecommendationTurn(handlerInput);

            // Stream the prose text in small chunks so the reveal feels live.
            const prose = handlerResult.assistant_message ?? "";
            const proseChunks = prose.match(/.{1,4}/g) ?? (prose ? [prose] : []);
            for (const chunk of proseChunks) {
              try {
                controller.enqueue(sseEvent("text", chunk));
              } catch { break; }
              await new Promise((r) => setTimeout(r, 8));
            }
          }

          // ── 2. Language enforcement ──────────────────────────────────────────
          const handlerResultWithLanguage = {
            ...handlerResult,
            assistant_message: enforceAssistantLanguageMatch({
              userMessage: turnMessage,
              assistantMessage: handlerResult.assistant_message,
            }),
          };

          // ── 3. Derived response fields ───────────────────────────────────────
          const responseMode = effectiveMode;
          const fineMode =
            routeDecision.needs_clarification && effectiveMode === "general_chat"
              ? "clarifying_question"
              : handlerResultWithLanguage.mode;
          const publicHandlerResult =
            "runtime_update" in handlerResultWithLanguage
              ? (() => {
                  const next = { ...handlerResultWithLanguage } as Record<string, unknown>;
                  delete next.runtime_update;
                  return next;
                })()
              : handlerResultWithLanguage;

          const assistantTurn: SessionMessage = {
            role: "assistant",
            content: handlerResultWithLanguage.assistant_message,
            created_at: new Date().toISOString(),
          };

          // ── 4. Session state update ──────────────────────────────────────────
          const nextConversationMemory = memoryEnabled
            ? mergeConversationMemory(sessionForHandler.conversation_memory, {
                userMessage: userTurn.content,
                assistantMessage: handlerResultWithLanguage.assistant_message,
                lastUserIntent: responseMode,
                noMatchAttempts:
                  effectiveMode === "recommendation"
                    ? handlerResultWithLanguage.mode === "no_match"
                      ? startingNoMatchAttempts + 1
                      : 0
                    : currentNoMatchAttempts,
                sessionFacts: Array.from(
                  new Set([
                    ...(parsedTurn.session_facts ?? []),
                    ...extractStableFactsFromUserMessage(userTurn.content),
                  ])
                ),
              })
            : nextSession.conversation_memory;

          const previousRuntime =
            sessionForHandlerWithReaction.recommendation_state.runtime ?? {};
          const likedRugIdsBefore = normalizeList(previousRuntime.liked_rug_ids ?? []).slice(0, 12);
          const dismissedRugIdsBefore = normalizeList(
            previousRuntime.dismissed_rug_ids ?? []
          ).slice(0, 12);
          const runtimeUpdate =
            "runtime_update" in handlerResultWithLanguage
              ? handlerResultWithLanguage.runtime_update
              : null;
          const nextRecentlyShownRugs = Array.isArray(runtimeUpdate?.recently_shown_rugs)
            ? runtimeUpdate.recently_shown_rugs
            : previousRuntime.recently_shown_rugs ?? [];
          const nextLikedRugIds = Array.isArray(runtimeUpdate?.liked_rug_ids)
            ? runtimeUpdate.liked_rug_ids
            : previousRuntime.liked_rug_ids ?? [];
          const nextDismissedRugIds = Array.isArray(runtimeUpdate?.dismissed_rug_ids)
            ? runtimeUpdate.dismissed_rug_ids
            : previousRuntime.dismissed_rug_ids ?? [];
          const nextShownRugIds = Array.isArray(runtimeUpdate?.shown_rug_ids)
            ? runtimeUpdate.shown_rug_ids
            : previousRuntime.shown_rug_ids ?? [];
          const nextLikedAttributesSource =
            runtimeUpdate?.liked_attributes ??
            previousRuntime.liked_attributes ?? {
              colors: [],
              styles: [],
              origins: [],
            };
          const nextLikedAttributes = {
            colors: [...(nextLikedAttributesSource.colors ?? [])],
            styles: [...(nextLikedAttributesSource.styles ?? [])],
            origins: [...(nextLikedAttributesSource.origins ?? [])],
          };
          const likedAttributesBefore = {
            colors: normalizeList(nextLikedAttributes.colors).slice(0, 8),
            styles: normalizeList(nextLikedAttributes.styles).slice(0, 8),
            origins: normalizeList(nextLikedAttributes.origins).slice(0, 8),
          };

          const reactionType = immediateReactionType;
          const referencedRugId = immediateReferencedRugId;

          updatedSession = {
            ...nextSession,
            role,
            updated_at: new Date().toISOString(),
            chat_history: trimChatHistory([...nextSession.chat_history, userTurn, assistantTurn]),
            conversation_memory: nextConversationMemory,
            recommendation_state: {
              ...nextSession.recommendation_state,
              hard_constraints: compiledPolicy.persisted_hard_constraints,
              runtime: {
                ...(nextSession.recommendation_state.runtime ?? {}),
                last_result_mode:
                  handlerResultWithLanguage.mode === "recommendation" ||
                  handlerResultWithLanguage.mode === "no_match" ||
                  handlerResultWithLanguage.mode === "clarifying_question" ||
                  handlerResultWithLanguage.mode === "disambiguation"
                    ? handlerResultWithLanguage.mode
                    : nextSession.recommendation_state.runtime?.last_result_mode,
                last_relaxed_size_tolerance_in:
                  "runtime_update" in handlerResultWithLanguage &&
                  handlerResultWithLanguage.runtime_update &&
                  Object.prototype.hasOwnProperty.call(
                    handlerResultWithLanguage.runtime_update,
                    "relaxed_size_tolerance_in"
                  )
                    ? handlerResultWithLanguage.runtime_update.relaxed_size_tolerance_in ?? null
                    : nextSession.recommendation_state.runtime?.last_relaxed_size_tolerance_in ?? null,
                last_blockers:
                  "runtime_update" in handlerResultWithLanguage &&
                  handlerResultWithLanguage.runtime_update?.blockers
                    ? handlerResultWithLanguage.runtime_update.blockers
                    : nextSession.recommendation_state.runtime?.last_blockers ?? [],
                last_recommended_size_in:
                  "runtime_update" in handlerResultWithLanguage &&
                  handlerResultWithLanguage.runtime_update &&
                  Object.prototype.hasOwnProperty.call(
                    handlerResultWithLanguage.runtime_update,
                    "last_recommended_size_in"
                  ) &&
                  handlerResultWithLanguage.runtime_update.last_recommended_size_in
                    ? handlerResultWithLanguage.runtime_update.last_recommended_size_in
                    : nextSession.recommendation_state.runtime?.last_recommended_size_in ?? null,
                liked_rug_ids: nextLikedRugIds,
                dismissed_rug_ids: nextDismissedRugIds,
                shown_rug_ids: normalizeList(nextShownRugIds).slice(0, 80),
                liked_attributes: {
                  colors: normalizeList(nextLikedAttributes.colors ?? []).slice(0, 8),
                  styles: normalizeList(nextLikedAttributes.styles ?? []).slice(0, 8),
                  origins: normalizeList(nextLikedAttributes.origins ?? []).slice(0, 8),
                },
                recently_shown_rugs: nextRecentlyShownRugs,
                no_match_attempts:
                  effectiveMode === "recommendation"
                    ? handlerResultWithLanguage.mode === "no_match"
                      ? startingNoMatchAttempts + 1
                      : 0
                    : currentNoMatchAttempts,
                updated_at: new Date().toISOString(),
              },
            },
          };

          // ── 5. E2E trace (only for QA runs) ─────────────────────────────────
          if (traceMeta) {
            const parseStatus = parserTrace.fallback_reason
              ? "fallback"
              : parserTrace.error && parserTrace.error.trim().length > 0
                ? "error"
                : "success";
            const constraintModes = {
              size: compiledPolicy.strictness.size,
              colors: compiledPolicy.strictness.colors,
              styles: compiledPolicy.strictness.styles,
              shape: compiledPolicy.strictness.shape,
              avoid: compiledPolicy.avoid,
            };
            const promptLayerPreview = buildPromptLayers({
              mode: effectiveMode,
              role,
              session: nextSession,
              userMessage,
            });
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
                  tenant_subdomain: tenantResolution.subdomain,
                  tenant_hostname: tenantResolution.hostname,
                  message: userMessage,
                  constraints: body.constraints ?? null,
                },
                routing: {
                  mode: effectiveMode,
                  intent: parsedTurn.intent,
                  rule_id: routeDecision.rule_id,
                  confidence: routeDecision.confidence,
                  needs_clarification: routeDecision.needs_clarification,
                  parser: {
                    model: parserTrace.model,
                    latency_ms: parserTrace.latency_ms,
                    status: parseStatus,
                    parse_status: parseStatus,
                    fallback: parserTrace.fallback_reason,
                    fallback_reason: parserTrace.fallback_reason,
                    normalized_payload: parserTrace.parsed,
                    normalized_parse_payload: parserTrace.parsed,
                    response_status: parserTrace.response_status,
                    incomplete_detected: parserTrace.incomplete_detected,
                    error: parserTrace.error,
                  },
                  policy: {
                    intent: compiledPolicy.intent,
                    compiled_policy: compiledPolicy,
                    policy_source: compiledPolicy.policy_source,
                    must_prefer_avoid: compiledPolicy.must_prefer_avoid,
                    "must-prefer-avoid": compiledPolicy.must_prefer_avoid,
                    constraint_modes: constraintModes,
                  },
                  parser_trace: {
                    called: parserTrace.called,
                    model: parserTrace.model,
                    status: parseStatus,
                    response_status: parserTrace.response_status,
                    fallback: parserTrace.fallback_reason,
                    fallback_reason: parserTrace.fallback_reason,
                    incomplete_detected: parserTrace.incomplete_detected,
                    latency_ms: parserTrace.latency_ms,
                    normalized_payload: parserTrace.parsed,
                    parsed: parserTrace.parsed,
                    error: parserTrace.error,
                  },
                  compiled_policy: compiledPolicy,
                  policy_source: compiledPolicy.policy_source,
                  must_prefer_avoid: compiledPolicy.must_prefer_avoid,
                  "must-prefer-avoid": compiledPolicy.must_prefer_avoid,
                  handler:
                    effectiveMode === "recommendation"
                      ? "handleRecommendationTurn"
                      : "handleGeneralChatTurn",
                  prompt_layer_preview: promptLayerPreview,
                },
                reaction: {
                  detected_reaction: reactionType,
                  referenced_rug_id: referencedRugId,
                  rug_reference_ambiguous: parsedTurn.rug_reference_ambiguous ?? false,
                  liked_attributes_before: likedAttributesBefore,
                  liked_attributes_after: {
                    colors: normalizeList(nextLikedAttributes.colors ?? []).slice(0, 8),
                    styles: normalizeList(nextLikedAttributes.styles ?? []).slice(0, 8),
                    origins: normalizeList(nextLikedAttributes.origins ?? []).slice(0, 8),
                  },
                  liked_rug_ids_before: likedRugIdsBefore,
                  liked_rug_ids_after: nextLikedRugIds,
                  dismissed_rug_ids_before: dismissedRugIdsBefore,
                  dismissed_rug_ids_after: nextDismissedRugIds,
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
                  response_mode: handlerResultWithLanguage.mode,
                  notes: handlerResultWithLanguage.notes ?? null,
                },
                timing_ms: {
                  total_ms: Date.now() - startedAt,
                },
              },
            });
          }

          // ── 6. Emit cards + done ─────────────────────────────────────────────
          const cardsPayload = {
            session_id: sessionId,
            role,
            mode: responseMode,
            fine_mode: fineMode,
            recommendation_state: updatedSession.recommendation_state,
            response: publicHandlerResult,
          };
          controller.enqueue(sseEvent("cards", cardsPayload));
          controller.enqueue(sseEvent("done", {}));
        } catch {
          // Best-effort: tell the client something went wrong so it can surface
          // an error state rather than hanging indefinitely.
          try {
            controller.enqueue(
              sseEvent("error", { message: "Unable to process your message right now." })
            );
          } catch { /* controller already closed */ }
        } finally {
          try { controller.close(); } catch { /* already closed */ }
          // Fire-and-forget session persistence — must not block the stream.
          if (updatedSession) {
            saveSession(updatedSession, {
              tenantId,
              mode: effectiveMode,
              turns: [userTurn, { role: "assistant", content: updatedSession.chat_history.at(-1)?.content ?? "", created_at: new Date().toISOString() }],
            }).catch(() => { /* ignore */ });
          }
        }
      },
    });

    const streamResponse = new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
    if (traceMeta) {
      streamResponse.headers.set("x-chat-route-trace-id", routeTraceId);
    }
    return streamResponse;
  } catch (error) {
    if (error instanceof SessionTenantMismatchError) {
      return forbidden("Session tenant does not match the current store domain.");
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
