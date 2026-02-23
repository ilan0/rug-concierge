import type { HardConstraints } from "@/lib/types/recommendation";
import type { AppRole } from "@/lib/auth/roles";

export type UiRole = AppRole;

export type UiProjectRoomContext = {
  room_id: string;
  room_name: string;
  constraints: HardConstraints;
  notes: string[];
  selected_rug_ids: string[];
};

export type UiProjectContextInput = {
  project_id?: string | null;
  name?: string | null;
  active_room_id?: string | null;
  rooms?: UiProjectRoomContext[];
  notes?: string[];
};

export type UiChatRequest = {
  session_id?: string;
  role: UiRole;
  message: string;
  tenant_id?: string;
  trade_client_id?: string;
  trade_preferences?: Record<string, unknown>;
  constraints?: HardConstraints;
  project_context?: UiProjectContextInput;
  review_action?: "approve" | "reject" | "regenerate" | "override";
  override?: {
    assistant_message?: string;
    selected_rug_ids?: string[];
    notes?: string;
  };
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
  review_state?: {
    last_user_message: string | null;
    last_assistant_message: string | null;
    last_recommendations: UiRecommendationItem[];
    last_questions: string[];
    last_mode: "recommendations" | "clarifying_question" | "no_match" | null;
    last_notes: string | null;
    decision: "none" | "approved" | "rejected" | "overridden" | "regenerated";
    decision_notes: string | null;
    decision_at: string | null;
    reviewed_by_role: UiRole | null;
    regenerate_count: number;
    override_count: number;
  };
  response: UiGeneralResponse | UiRecommendationResponse | UiAppraisalResponse;
};
