"use client";

import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import {
  resetChatSession,
  streamChatTurn,
} from "@/lib/concierge/client";
import type { UiChatRequest, UiChatResponseBody } from "@/lib/types/chat-ui";
import {
  STARTER_PROMPTS,
  type StarterPrompt,
} from "@/components/concierge/utils";
import type {
  ConciergeVariant,
  Turn,
} from "@/components/concierge/types";

type UseConciergeControllerInput = {
  variant: ConciergeVariant;
  tenantId: string;
};

type UiRecommendationState = NonNullable<UiChatResponseBody["recommendation_state"]>;

type SendUserTurnOptions = {
  appendUserTurn?: boolean;
  preserveFailedMessage?: boolean;
  constraints?: UiChatRequest["constraints"];
};

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
  const { tenantId } = input;

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recommendationState, setRecommendationState] =
    useState<UiRecommendationState | null>(null);
  const [lastFailedMessage, setLastFailedMessage] = useState<string | null>(null);
  const [showSlowNotice, setShowSlowNotice] = useState(false);
  const [isResettingChat, setIsResettingChat] = useState(false);

  useEffect(() => {
    if (!isLoading) {
      setShowSlowNotice(false);
      return undefined;
    }
    const timer = window.setTimeout(() => setShowSlowNotice(true), 5000);
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

  const canSubmit = useMemo(
    () => message.trim().length > 0 && !isLoading,
    [message, isLoading]
  );

  const starterPrompts = STARTER_PROMPTS.concierge;

  const getConstraintSnapshot = (
    nextState: UiRecommendationState | null | undefined
  ): Turn["constraintSnapshot"] => nextState ?? null;

  const buildChatRequestPayload = (
    userMessage: string,
    constraints?: UiChatRequest["constraints"]
  ): UiChatRequest => ({
    session_id: sessionId ?? undefined,
    role: "retail_customer",
    message: userMessage,
    constraints,
  });

  const sendUserTurn = async (
    userMessage: string,
    options: SendUserTurnOptions = {}
  ) => {
    if (!userMessage.trim()) return;
    setError(null);
    setIsLoading(true);
    if (!options.preserveFailedMessage) setLastFailedMessage(null);

    // Append user turn immediately.
    if (options.appendUserTurn ?? true) {
      setTurns((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "user",
          text: userMessage,
          createdAt: new Date().toISOString(),
        },
      ]);
    }

    // Create a streaming placeholder assistant turn that fills in token-by-token.
    const assistantTurnId = crypto.randomUUID();
    setTurns((prev) => [
      ...prev,
      {
        id: assistantTurnId,
        role: "assistant",
        text: "",
        isStreaming: true,
        createdAt: new Date().toISOString(),
      },
    ]);

    try {
      await streamChatTurn(
        buildChatRequestPayload(userMessage, options.constraints),
        {
          onText: (chunk) => {
            setTurns((prev) =>
              prev.map((t) =>
                t.id === assistantTurnId ? { ...t, text: t.text + chunk } : t
              )
            );
          },
          onCards: (payload) => {
            setSessionId(payload.session_id);
            setRecommendationState(payload.recommendation_state ?? null);
            const response = payload.response;
            setTurns((prev) =>
              prev.map((t) =>
                t.id === assistantTurnId
                  ? {
                      ...t,
                      coarseMode: payload.mode,
                      fineMode: payload.fine_mode,
                      recommendations:
                        "recommendations" in response
                          ? response.recommendations
                          : undefined,
                      questions:
                        "questions" in response ? response.questions : undefined,
                      constraintSnapshot: getConstraintSnapshot(
                        payload.recommendation_state
                      ),
                    }
                  : t
              )
            );
          },
          onDone: () => {
            setTurns((prev) =>
              prev.map((t) =>
                t.id === assistantTurnId ? { ...t, isStreaming: false } : t
              )
            );
            if (options.preserveFailedMessage) setLastFailedMessage(null);
          },
          onError: (message) => {
            setTurns((prev) => prev.filter((t) => t.id !== assistantTurnId));
            setError(message);
            if (!options.preserveFailedMessage) setLastFailedMessage(userMessage);
          },
        }
      );
    } catch (nextError) {
      setTurns((prev) => prev.filter((t) => t.id !== assistantTurnId));
      const details =
        nextError instanceof Error ? nextError.message : "Failed to send message.";
      setError(details);
      if (!options.preserveFailedMessage) setLastFailedMessage(userMessage);
    } finally {
      // Clean up any unresolved streaming flag (e.g. stream closed without done event).
      setTurns((prev) =>
        prev.map((t) =>
          t.id === assistantTurnId && t.isStreaming ? { ...t, isStreaming: false } : t
        )
      );
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

  const submitWithPrompt = (prompt: StarterPrompt) => {
    const userMessage = prompt.message.trim();
    if (!userMessage || isLoading) return;
    setMessage("");
    void sendUserTurn(userMessage, {
      constraints: prompt.constraints,
    });
  };

  const onRetryLastMessage = async () => {
    if (!lastFailedMessage || isLoading) return;
    await sendUserTurn(lastFailedMessage, {
      appendUserTurn: false,
      preserveFailedMessage: true,
    });
  };

  const onReset = () => {
    setSessionId(null);
    setTurns([]);
    setMessage("");
    setError(null);
    setLastFailedMessage(null);
    setRecommendationState(null);
  };

  const onNewChat = async () => {
    if (isLoading || isResettingChat) return;

    setError(null);
    setIsResettingChat(true);
    try {
      const payload = await resetChatSession({
        session_id: sessionId,
      });
      setSessionId(payload.new_session_id);
      setTurns([]);
      setMessage("");
      setLastFailedMessage(null);
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
    recommendationState,
    showSlowNotice,
    isResettingChat,
    canSubmit,
    lastFailedMessage,
    starterPrompts,
    onSubmit,
    submitWithPrompt,
    onRetryLastMessage,
    onReset,
    onNewChat,
    effectiveTenantId: tenantId,
  };
}
