import type { HardConstraints } from "@/lib/types/recommendation";
import type { RecommendationResponse } from "@/lib/ai/recommend";
import type { E2eTraceMeta } from "@/lib/qa/e2e-trace";
import type { AppRole } from "@/lib/auth/roles";

export type RoleType = AppRole;

export type ChatMode = "general_chat" | "recommendation";
export type ChatFineMode =
  | "general_chat"
  | "recommendation"
  | "clarifying_question"
  | "no_match";

export type SessionMessage = {
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

export type ConversationMemory = {
  summary_text: string;
  stable_facts: string[];
  open_threads: string[];
  last_user_intent: "general_chat" | "recommendation" | "unknown";
  updated_at: string;
  version: "v1";
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
  tenant_id: string | null;
  role: RoleType;
  chat_history: SessionMessage[];
  conversation_memory: ConversationMemory;
  recommendation_state: RecommendationState;
  created_at: string;
  updated_at: string;
};

export type ChatTurnRequest = {
  session_id?: string;
  role?: RoleType;
  user_role?: RoleType;
  message: string;
  tenant_id?: string;
  constraints?: HardConstraints;
};

export type ChatTurnHandlerInput = {
  message: string;
  role: RoleType;
  mode: ChatMode;
  session: SessionData;
  ai_context_packet?: import("@/lib/chat/context-packet").ChatAiContextPacket;
  tenant_id: string | null;
  trace_meta?: E2eTraceMeta;
  needs_clarification?: boolean;
};

export type GeneralChatResponse = {
  mode: "general_chat" | "clarifying_question";
  assistant_message: string;
  notes: string | null;
  follow_up_question?: string | null;
};

export type RecommendationTurnResponse = Omit<RecommendationResponse, "mode"> & {
  mode: "recommendation" | "clarifying_question" | "no_match";
};
