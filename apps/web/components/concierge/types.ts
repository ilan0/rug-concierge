import type { UiChatResponseBody, UiRecommendationItem } from "@/lib/types/chat-ui";

export type DebugTraceSummary = {
  routeTrace: unknown | null;
  pipelineTrace: unknown | null;
  generalChatTrace: unknown | null;
};

export type DebugMeta = {
  runId: string;
  caseId: string;
  routeTraceId: string | null;
  trace: DebugTraceSummary | null;
  traceError: string | null;
};

export type Turn = {
  id: string;
  role: "user" | "assistant";
  text: string;
  coarseMode?: UiChatResponseBody["mode"];
  fineMode?: UiChatResponseBody["fine_mode"];
  recommendations?: UiRecommendationItem[];
  questions?: string[];
  followUpQuestion?: string | null;
  constraintSnapshot?: UiChatResponseBody["recommendation_state"] | null;
  createdAt: string;
  debug?: DebugMeta | null;
};

export type OperatorView = "debug";

export type ConciergeVariant = "concierge";
