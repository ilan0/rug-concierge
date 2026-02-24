import type { UiChatRequest, UiChatResponseBody } from "@/lib/types/chat-ui";
import { mapApiErrorToFriendlyMessage } from "@/lib/ui/error-messages";

type DebugTraceMeta = {
  runId: string;
  caseId: string;
};

type SendChatTurnOptions = {
  debugTrace?: DebugTraceMeta;
};

type SendChatTurnResult = {
  payload: UiChatResponseBody;
  headers: {
    chatRouteTraceId: string | null;
  };
};

export async function sendChatTurn(
  input: UiChatRequest,
  options: SendChatTurnOptions = {}
): Promise<SendChatTurnResult> {
  // `role` is the canonical request field for chat clients.
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (options.debugTrace) {
    headers["x-e2e-trace-run"] = options.debugTrace.runId;
    headers["x-e2e-trace-case"] = options.debugTrace.caseId;
  }

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

export async function fetchChatDebugTrace(
  runId: string,
  caseId: string
): Promise<unknown> {
  const response = await fetch(
    `/api/debug/trace?run=${encodeURIComponent(runId)}&case=${encodeURIComponent(
      caseId
    )}`
  );

  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    const payloadError =
      payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error: unknown }).error)
        : null;
    const payloadCode =
      payload && typeof payload === "object" && "code" in payload
        ? String((payload as { code: unknown }).code)
        : null;
    throw new Error(
      mapApiErrorToFriendlyMessage({
        status: response.status,
        code: payloadCode,
        rawMessage: payloadError,
        context: "debug_trace",
        fallbackMessage: "Unable to load debug trace payload.",
      })
    );
  }
  return payload;
}
