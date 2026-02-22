import type { HardConstraints } from "@/lib/types/recommendation";

export type UiRole = "retail_customer" | "trade_client" | "store_staff";

export type UiChatRequest = {
  session_id?: string;
  role: UiRole;
  message: string;
  constraints?: HardConstraints;
};

export type UiRecommendationItem = {
  rug_id: string;
  sku: string | null;
  title: string;
  size_text: string | null;
  price_usd: number | null;
  match_reasons: string[];
  confidence: number;
  confidence_tier: "high" | "medium" | "low";
  confidence_factors: string[];
  why_not: string[];
};

type UiGeneralResponse = {
  mode: "general_chat";
  assistant_message: string;
  notes: string | null;
};

type UiRecommendationResponse = {
  mode: "recommendation" | "clarifying_question" | "no_match";
  assistant_message: string;
  questions: string[];
  recommendations: UiRecommendationItem[];
  notes: string | null;
};

type UiAppraisalResponse = {
  mode: "appraisal";
  assistant_message: string;
  notes: string | null;
};

export type UiChatResponseBody = {
  session_id: string;
  role: UiRole;
  mode: "general_chat" | "recommendation" | "appraisal";
  response: UiGeneralResponse | UiRecommendationResponse | UiAppraisalResponse;
};
