"use client";

import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import {
  fetchChatDebugTrace,
  resetChatSession,
  sendChatTurn,
} from "@/lib/concierge/client";
import type { UiChatRequest, UiChatResponseBody } from "@/lib/types/chat-ui";
import {
  STARTER_PROMPTS,
  summarizeTracePayload,
  toSlug,
} from "@/components/concierge/utils";
import type {
  ConciergeVariant,
  OperatorView,
  Turn,
} from "@/components/concierge/types";

type UseConciergeControllerInput = {
  debug: boolean;
  variant: ConciergeVariant;
  tenantId: string;
};

type UiRecommendationState = NonNullable<UiChatResponseBody["recommendation_state"]>;

function storageSessionKey(tenantId: string): string {
  return `rug_concierge_session_id:${tenantId}`;
}

function storageTurnsKey(tenantId: string): string {
  return `rug_concierge_turns:${tenantId}`;
}

function readSessionStorage(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSessionStorage(key: string, value: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (value === null) {
      window.sessionStorage.removeItem(key);
      return;
    }
    window.sessionStorage.setItem(key, value);
  } catch {
    // Ignore storage write failures in restrictive browser contexts.
  }
}

export function useConciergeController(input: UseConciergeControllerInput) {
  const { debug, tenantId } = input;

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedTurnId, setSelectedTurnId] = useState<string | null>(null);
  const [recommendationState, setRecommendationState] =
    useState<UiRecommendationState | null>(null);
  const [lastFailedMessage, setLastFailedMessage] = useState<string | null>(null);
  const [operatorOpen, setOperatorOpen] = useState(false);
  const [operatorView, setOperatorView] = useState<OperatorView>("debug");
  const [showSlowNotice, setShowSlowNotice] = useState(false);
  const [isResettingChat, setIsResettingChat] = useState(false);

  useEffect(() => {
    if (!isLoading) {
      setShowSlowNotice(false);
      return undefined;
    }
    const timer = window.setTimeout(() => setShowSlowNotice(true), 8000);
    return () => window.clearTimeout(timer);
  }, [isLoading]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const sessionKey = storageSessionKey(tenantId);
    const turnsKey = storageTurnsKey(tenantId);

    // Legacy cleanup: historical localStorage persistence leaked prior sessions
    // across fresh tabs. Keep new persistence scoped to the current tab only.
    try {
      window.localStorage.removeItem(sessionKey);
      window.localStorage.removeItem(turnsKey);
    } catch {
      // Ignore storage cleanup failures in restrictive browser contexts.
    }

    const storedSessionId = readSessionStorage(sessionKey);
    if (storedSessionId && storedSessionId.trim().length > 0) {
      setSessionId(storedSessionId.trim());
    }

    const storedTurns = readSessionStorage(turnsKey);
    if (!storedTurns) return;

    try {
      const parsed = JSON.parse(storedTurns);
      if (!Array.isArray(parsed)) return;

      const safeTurns = parsed.filter((item) => {
        return (
          item &&
          typeof item === "object" &&
          typeof (item as { id?: unknown }).id === "string" &&
          typeof (item as { role?: unknown }).role === "string" &&
          typeof (item as { text?: unknown }).text === "string"
        );
      }) as Turn[];

      if (safeTurns.length > 0) {
        setTurns(safeTurns);
      }
    } catch {
      // Ignore invalid persisted chat payloads.
    }
  }, [tenantId]);

  useEffect(() => {
    const key = storageSessionKey(tenantId);
    if (sessionId && sessionId.trim().length > 0) {
      writeSessionStorage(key, sessionId);
      return;
    }
    writeSessionStorage(key, null);
  }, [sessionId, tenantId]);

  useEffect(() => {
    const key = storageTurnsKey(tenantId);
    if (turns.length === 0) {
      writeSessionStorage(key, null);
      return;
    }
    writeSessionStorage(key, JSON.stringify(turns.slice(-40)));
  }, [tenantId, turns]);

  const debugRunId = useMemo(
    () => toSlug(`concierge-debug-${new Date().toISOString().replace(/[:.]/g, "-")}`),
    []
  );

  const canSubmit = useMemo(
    () => message.trim().length > 0 && !isLoading,
    [message, isLoading]
  );

  const starterPrompts = STARTER_PROMPTS.concierge;

  const selectedTurn = turns.find((turn) => turn.id === selectedTurnId) ?? null;
  const latestAssistantTurn = [...turns]
    .reverse()
    .find((turn) => turn.role === "assistant");
  const latestAssistantMode = latestAssistantTurn?.fineMode;

  const isDeveloperRole = process.env.NODE_ENV !== "production";
  const canUseDebugTrace = isDeveloperRole;
  const canOpenOperator = isDeveloperRole;

  useEffect(() => {
    if (!canOpenOperator && operatorOpen) {
      setOperatorOpen(false);
    }
  }, [canOpenOperator, operatorOpen]);

  const getConstraintSnapshot = (
    nextState: UiRecommendationState | null | undefined
  ): Turn["constraintSnapshot"] => nextState ?? null;

  const buildChatRequestPayload = (userMessage: string): UiChatRequest => ({
    session_id: sessionId ?? undefined,
    role: "retail_customer",
    message: userMessage,
    tenant_id: tenantId,
  });

  const sendUserTurn = async (userMessage: string) => {
    if (!userMessage.trim()) return;
    setError(null);
    setIsLoading(true);
    setLastFailedMessage(null);

    const debugCaseId =
      debug && canUseDebugTrace
        ? toSlug(`turn-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`)
        : null;

    const userTurn: Turn = {
      id: crypto.randomUUID(),
      role: "user",
      text: userMessage,
      createdAt: new Date().toISOString(),
    };
    setTurns((prev) => [...prev, userTurn]);

    try {
      const { payload, headers } = await sendChatTurn(
        buildChatRequestPayload(userMessage),
        debug && canUseDebugTrace && debugCaseId
          ? {
              debugTrace: {
                runId: debugRunId,
                caseId: debugCaseId,
              },
            }
          : undefined
      );

      setSessionId(payload.session_id);
      setRecommendationState(payload.recommendation_state ?? null);

      let debugMeta: Turn["debug"] = null;
      if (debug && canUseDebugTrace && debugCaseId) {
        try {
          const tracePayload = await fetchChatDebugTrace(debugRunId, debugCaseId);
          debugMeta = {
            runId: debugRunId,
            caseId: debugCaseId,
            routeTraceId: headers.chatRouteTraceId,
            trace: summarizeTracePayload(tracePayload),
            traceError: null,
          };
        } catch (traceError) {
          debugMeta = {
            runId: debugRunId,
            caseId: debugCaseId,
            routeTraceId: headers.chatRouteTraceId,
            trace: null,
            traceError:
              traceError instanceof Error
                ? traceError.message
                : "Failed to load trace payload.",
          };
        }
      }

      const response = payload.response;
      const assistantTurn: Turn = {
        id: crypto.randomUUID(),
        role: "assistant",
        text: response.assistant_message,
        coarseMode: payload.mode,
        fineMode: payload.fine_mode,
        recommendations:
          "recommendations" in response ? response.recommendations : undefined,
        questions: "questions" in response ? response.questions : undefined,
        followUpQuestion:
          "follow_up_question" in response ? response.follow_up_question : null,
        constraintSnapshot: getConstraintSnapshot(payload.recommendation_state),
        createdAt: new Date().toISOString(),
        debug: debugMeta,
      };

      setTurns((prev) => [...prev, assistantTurn]);
      setSelectedTurnId(assistantTurn.id);
    } catch (nextError) {
      const details =
        nextError instanceof Error ? nextError.message : "Failed to send message.";
      setError(details);
      setLastFailedMessage(userMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const userMessage = message.trim();
    if (!userMessage) return;
    setMessage("");
    await sendUserTurn(userMessage);
  };

  const submitWithPrompt = (prompt: string) => {
    const userMessage = prompt.trim();
    if (!userMessage || isLoading) return;
    setMessage("");
    void sendUserTurn(userMessage);
  };

  const onRetryLastMessage = async () => {
    if (!lastFailedMessage || isLoading) return;
    await sendUserTurn(lastFailedMessage);
  };

  const onReset = () => {
    setSessionId(null);
    setTurns([]);
    setMessage("");
    setError(null);
    setLastFailedMessage(null);
    setSelectedTurnId(null);
    setRecommendationState(null);
  };

  const onNewChat = async () => {
    if (isLoading || isResettingChat) return;

    setError(null);
    setIsResettingChat(true);
    try {
      const payload = await resetChatSession({
        session_id: sessionId,
        tenant_id: tenantId,
      });
      setSessionId(payload.new_session_id);
      setTurns([]);
      setMessage("");
      setLastFailedMessage(null);
      setSelectedTurnId(null);
      setRecommendationState(null);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Unable to reset chat right now."
      );
    } finally {
      setIsResettingChat(false);
    }
  };

  return {
    sessionId,
    message,
    setMessage,
    turns,
    isLoading,
    error,
    selectedTurn,
    selectedTurnId,
    setSelectedTurnId,
    recommendationState,
    operatorOpen,
    setOperatorOpen,
    operatorView,
    setOperatorView,
    showSlowNotice,
    isResettingChat,
    debugRunId,
    canSubmit,
    lastFailedMessage,
    starterPrompts,
    latestAssistantMode,
    isDeveloperRole,
    canUseDebugTrace,
    canOpenOperator,
    onSubmit,
    submitWithPrompt,
    onRetryLastMessage,
    onReset,
    onNewChat,
    effectiveTenantId: tenantId,
  };
}
