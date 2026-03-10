import type { HardConstraints } from "@/lib/types/recommendation";
import type { AppRole } from "@/lib/auth/roles";

export type UiRole = AppRole;

export type UiChatRequest = {
  session_id?: string;
  role: UiRole;
  message: string;
  tenant_id?: string;
  constraints?: HardConstraints;
};

export type UiRecommendationItem = {
  rug_id: string;
  title: string;
  primary_image_url: string | null;
  primary_image_caption: string | null;
  size_text: string | null;
  match_reasons: string[];
  confidence: number;
  confidence_tier: "high" | "medium" | "low";
  confidence_factors: string[];
  why_not: string[];
};

type UiGeneralResponse = {
  mode: "general_chat" | "clarifying_question";
  assistant_message: string;
  notes: string | null;
  follow_up_question?: string | null;
};

type UiRecommendationResponse = {
  mode: "recommendation" | "clarifying_question" | "no_match";
  assistant_message: string;
  questions: string[];
  recommendations: UiRecommendationItem[];
  notes: string | null;
};

export type UiChatResponseBody = {
  session_id: string;
  role: UiRole;
  mode: "general_chat" | "recommendation";
  fine_mode:
    | "general_chat"
    | "recommendation"
    | "clarifying_question"
    | "no_match";
  recommendation_state?: {
    hard_constraints: HardConstraints;
    soft_preferences?: {
      style?: string;
      palette?: string;
      room?: string;
      notes?: string[];
    };
  };
  response: UiGeneralResponse | UiRecommendationResponse;
};
