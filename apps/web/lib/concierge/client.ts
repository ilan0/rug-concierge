import type { UiChatRequest, UiChatResponseBody } from "@/lib/types/chat-ui";
import { mapApiErrorToFriendlyMessage } from "@/lib/ui/error-messages";

type SendChatTurnResult = {
  payload: UiChatResponseBody;
  headers: {
    chatRouteTraceId: string | null;
  };
};

type ResetChatSessionResult = {
  success: true;
  new_session_id: string;
};

export async function sendChatTurn(
  input: UiChatRequest
): Promise<SendChatTurnResult> {
  // `role` is the canonical request field for chat clients.
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  const response = await fetch("/api/chat", {
    method: "POST",
    headers,
    body: JSON.stringify(input),
  });

  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const payloadError =
      payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error: unknown }).error)
        : null;
    const payloadCode =
      payload && typeof payload === "object" && "code" in payload
        ? String((payload as { code: unknown }).code)
        : null;
    const message =
      mapApiErrorToFriendlyMessage({
        status: response.status,
        code: payloadCode,
        rawMessage: payloadError,
        context: "chat",
        fallbackMessage: "Unable to process chat request right now.",
      });
    throw new Error(message);
  }

  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid chat response payload.");
  }

  return {
    payload: payload as UiChatResponseBody,
    headers: {
      chatRouteTraceId: response.headers.get("x-chat-route-trace-id"),
    },
  };
}

export async function resetChatSession(input: {
  session_id?: string | null;
}): Promise<ResetChatSessionResult> {
  const response = await fetch("/api/session/reset", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      session_id: input.session_id ?? undefined,
    }),
  });

  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    const payloadError =
      payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error: unknown }).error)
        : null;
    throw new Error(
      mapApiErrorToFriendlyMessage({
        status: response.status,
        context: "generic",
        rawMessage: payloadError,
        fallbackMessage: "Unable to reset chat right now.",
      })
    );
  }

  if (
    !payload ||
    typeof payload !== "object" ||
    (payload as { success?: unknown }).success !== true ||
    typeof (payload as { new_session_id?: unknown }).new_session_id !== "string"
  ) {
    throw new Error("Invalid reset session response payload.");
  }

  return payload as ResetChatSessionResult;
}
