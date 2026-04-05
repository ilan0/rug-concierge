import type { UiChatResponseBody, UiRecommendationItem } from "@/lib/types/chat-ui";

export type Turn = {
  id: string;
  role: "user" | "assistant";
  text: string;
  coarseMode?: UiChatResponseBody["mode"];
  fineMode?: UiChatResponseBody["fine_mode"];
  recommendations?: UiRecommendationItem[];
  questions?: string[];
  constraintSnapshot?: UiChatResponseBody["recommendation_state"] | null;
  createdAt: string;
};

export type ConciergeVariant = "concierge";
