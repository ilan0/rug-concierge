import type { UiChatRequest, UiChatResponseBody } from "@/lib/types/chat-ui";
import { mapApiErrorToFriendlyMessage } from "@/lib/ui/error-messages";

type ResetChatSessionResult = {
  success: true;
  new_session_id: string;
};

type StreamChatTurnCallbacks = {
  onText: (chunk: string) => void;
  onCards: (payload: UiChatResponseBody) => void;
  onDone: () => void;
  onError: (message: string) => void;
};

export async function streamChatTurn(
  input: UiChatRequest,
  callbacks: StreamChatTurnCallbacks
): Promise<void> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Accept": "text/event-stream",
  };

  let response: Response;
  try {
    response = await fetch("/api/chat", {
      method: "POST",
      headers,
      body: JSON.stringify(input),
    });
  } catch {
    callbacks.onError("Unable to reach the server. Please check your connection.");
    return;
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    let payloadError: string | null = null;
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === "object" && "error" in parsed) {
        payloadError = String(parsed.error);
      }
    } catch { /* ignore */ }
    const message = mapApiErrorToFriendlyMessage({
      status: response.status,
      rawMessage: payloadError,
      context: "chat",
      fallbackMessage: "Unable to process chat request right now.",
    });
    callbacks.onError(message);
    return;
  }

  const reader = response.body?.getReader();
  if (!reader) {
    callbacks.onError("Stream unavailable.");
    return;
  }

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";

      for (const part of parts) {
        const eventMatch = part.match(/^event: (\w+)\ndata: (.+)$/);
        if (!eventMatch) continue;
        const [, event, data] = eventMatch;
        try {
          const parsed = JSON.parse(data);
          if (event === "text") callbacks.onText(parsed as string);
          else if (event === "cards") callbacks.onCards(parsed as UiChatResponseBody);
          else if (event === "done") callbacks.onDone();
        } catch { /* ignore malformed chunks */ }
      }
    }
  } finally {
    reader.releaseLock();
  }
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
