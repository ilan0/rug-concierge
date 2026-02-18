import type { HardConstraints } from "@/lib/types/recommendation";
import type { RecommendationResponse } from "@/lib/ai/recommend";
import type {
  AppraisalDraftResponse,
  AppraisalInput,
} from "@/lib/types/appraisal";

export type RoleType = "retail_customer" | "trade_client" | "store_staff";

export type ChatMode = "general_chat" | "recommendation" | "appraisal";

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

export type TradeContext = {
  tenant_id: string | null;
  trade_client_id: string | null;
  preferences: Record<string, unknown>;
  preferences_source: "none" | "request" | "session";
};

export type ProjectRoomContext = {
  room_id: string;
  room_name: string;
  constraints: HardConstraints;
  notes: string[];
  selected_rug_ids: string[];
};

export type ProjectContext = {
  project_id: string | null;
  name: string | null;
  active_room_id: string | null;
  rooms: ProjectRoomContext[];
  notes: string[];
};

export type SessionData = {
  session_id: string;
  role: RoleType;
  chat_history: SessionMessage[];
  recommendation_state: RecommendationState;
  trade_context: TradeContext;
  project_context: ProjectContext;
  created_at: string;
  updated_at: string;
};

export type ChatTurnRequest = {
  session_id?: string;
  role?: RoleType;
  message: string;
  tenant_id?: string;
  trade_client_id?: string;
  trade_preferences?: Record<string, unknown>;
  constraints?: HardConstraints;
  project_context?: Partial<ProjectContext>;
  appraisal_context?: AppraisalInput;
};

export type ChatTurnHandlerInput = {
  message: string;
  role: RoleType;
  mode: ChatMode;
  session: SessionData;
  tenant_id: string | null;
  appraisal_context?: AppraisalInput;
};

export type GeneralChatResponse = {
  mode: "general_chat";
  assistant_message: string;
  notes: string | null;
};

export type RecommendationTurnResponse = RecommendationResponse & {
  mode: "recommendation" | "clarifying_question" | "no_match";
};

export type AppraisalTurnResponse = AppraisalDraftResponse & {
  mode: "appraisal";
};
