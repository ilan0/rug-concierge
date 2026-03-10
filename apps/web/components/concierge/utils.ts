import type { UiChatResponseBody } from "@/lib/types/chat-ui";
import type { DebugTraceSummary, ConciergeVariant } from "@/components/concierge/types";

export const STARTER_PROMPTS: Record<ConciergeVariant, string[]> = {
  concierge: [
    "Show me what you have",
    "I need something 8x10 for my living room",
    "Show dining room options",
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

function normalizeForComparison(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSet(value: string): Set<string> {
  return new Set(
    normalizeForComparison(value)
      .split(" ")
      .map((token) => token.trim())
      .filter((token) => token.length > 1)
  );
}

function tokenOverlapRatio(left: string, right: string): number {
  const leftSet = tokenSet(left);
  const rightSet = tokenSet(right);
  if (leftSet.size === 0 || rightSet.size === 0) return 0;

  let overlap = 0;
  for (const token of leftSet) {
    if (rightSet.has(token)) overlap += 1;
  }

  return overlap / Math.max(leftSet.size, rightSet.size);
}

export function shouldRenderFollowUpQuestion(
  assistantMessage: string,
  followUpQuestion: string | null | undefined
): boolean {
  if (!followUpQuestion) return false;
  const normalizedAssistant = normalizeForComparison(assistantMessage);
  const normalizedFollowUp = normalizeForComparison(followUpQuestion);
  if (!normalizedFollowUp) return false;

  if (normalizedAssistant === normalizedFollowUp) return false;
  if (normalizedAssistant.includes(normalizedFollowUp)) return false;
  if (normalizedFollowUp.includes(normalizedAssistant)) return false;
  if (tokenOverlapRatio(normalizedAssistant, normalizedFollowUp) >= 0.92) return false;

  return true;
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
