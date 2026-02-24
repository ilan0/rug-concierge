import type { UiChatResponseBody, UiRecommendationItem } from "@/lib/types/chat-ui";

export type DebugTraceSummary = {
  routeTrace: unknown | null;
  pipelineTrace: unknown | null;
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
  responseMode?: UiChatResponseBody["mode"];
  recommendations?: UiRecommendationItem[];
  questions?: string[];
  createdAt: string;
  debug?: DebugMeta | null;
};

export type UiReviewState = NonNullable<UiChatResponseBody["review_state"]>;
export type OperatorView = "debug" | "review";

export type ConciergeVariant = "concierge" | "trade";
