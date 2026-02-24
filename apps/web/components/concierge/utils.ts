import type { UiChatResponseBody } from "@/lib/types/chat-ui";
import type { DebugTraceSummary, ConciergeVariant } from "@/components/concierge/types";

export const STARTER_PROMPTS: Record<ConciergeVariant, string[]> = {
  concierge: [
    "Show me what you have",
    "I need an 8x10 under $2500",
    "Show dining room options",
  ],
  trade: [
    "Need three options for a living room project under $4,000 each",
    "Show me neutral styles for a designer client mood board",
    "Find rugs that layer well with modern furniture",
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

export function modeLabel(mode: UiChatResponseBody["mode"] | undefined): string | null {
  if (!mode) return null;
  if (mode === "recommendation") return "recommendations";
  if (mode === "general_chat") return "general chat";
  if (mode === "appraisal") return "appraisal";
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
    return { routeTrace: null, pipelineTrace: null };
  }

  const data = payload as {
    traces?: Array<{ channel?: string | null; payload?: unknown }>;
  };
  if (!Array.isArray(data.traces)) {
    return { routeTrace: null, pipelineTrace: null };
  }

  const routeTrace =
    data.traces.find((trace) => trace?.channel === "chat-route")?.payload ?? null;
  const pipelineTrace =
    data.traces.find((trace) => trace?.channel === "recommendation-pipeline")
      ?.payload ?? null;

  return { routeTrace, pipelineTrace };
}
