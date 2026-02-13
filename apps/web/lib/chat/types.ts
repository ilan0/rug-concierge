import type { HardConstraints, InventoryRug } from "@/lib/types/recommendation";
import type { RecommendationResponse } from "@/lib/ai/recommend";

export type RoleType = "retail_customer" | "trade_client" | "store_staff";

export type ChatMode = "general_chat" | "recommendation";

export type SessionMessage = {
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

export type RecommendationState = {
  hard_constraints: HardConstraints;
  soft_preferences: {
    style?: string;
    palette?: string;
    room?: string;
    notes?: string[];
  };
};

export type SessionData = {
  session_id: string;
  role: RoleType;
  chat_history: SessionMessage[];
  recommendation_state: RecommendationState;
  created_at: string;
  updated_at: string;
};

export type ChatTurnRequest = {
  session_id?: string;
  role?: RoleType;
  message: string;
  constraints?: HardConstraints;
  inventory?: InventoryRug[];
};

export type ChatTurnHandlerInput = {
  message: string;
  role: RoleType;
  mode: ChatMode;
  session: SessionData;
  inventory: InventoryRug[];
};

export type GeneralChatResponse = {
  mode: "general_chat";
  assistant_message: string;
  notes: string | null;
};

export type RecommendationTurnResponse = RecommendationResponse & {
  mode: "recommendation" | "clarifying_question" | "no_match";
};

