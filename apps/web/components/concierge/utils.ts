import type { UiChatResponseBody } from "@/lib/types/chat-ui";
import type { DebugTraceSummary, ConciergeVariant } from "@/components/concierge/types";

export const STARTER_PROMPTS: Record<ConciergeVariant, string[]> = {
  concierge: [
    "Help me find a living room anchor rug",
    "Show me a range to react to",
    "I need something around 8x10",
  ],
};

export function toRoomId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function modeLabel(
  mode: UiChatResponseBody["fine_mode"] | UiChatResponseBody["mode"] | undefined
): string | null {
  if (!mode) return null;
  if (mode === "recommendation") return "recommendations";
  if (mode === "clarifying_question") return "clarifying question";
  if (mode === "disambiguation") return "disambiguation";
  if (mode === "no_match") return "no match";
  if (mode === "general_chat") return "general chat";
  return mode;
}

export function toSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

export function summarizeTracePayload(payload: unknown): DebugTraceSummary {
  if (!payload || typeof payload !== "object") {
    return { routeTrace: null, pipelineTrace: null, generalChatTrace: null };
  }

  const data = payload as {
    traces?: Array<{ channel?: string | null; payload?: unknown }>;
  };
  if (!Array.isArray(data.traces)) {
    return { routeTrace: null, pipelineTrace: null, generalChatTrace: null };
  }

  const routeTrace =
    data.traces.find((trace) => trace?.channel === "chat-route")?.payload ?? null;
  const pipelineTrace =
    data.traces.find((trace) => trace?.channel === "recommendation-pipeline")
      ?.payload ?? null;
  const generalChatTrace =
    data.traces.find((trace) => trace?.channel === "general-chat-ai")?.payload ??
    null;

  return { routeTrace, pipelineTrace, generalChatTrace };
}
