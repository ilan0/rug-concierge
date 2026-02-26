import type { HardConstraints } from "@/lib/types/recommendation";
import type { RecommendationResponse } from "@/lib/ai/recommend";
import type {
  AppraisalDraftResponse,
  AppraisalInput,
} from "@/lib/types/appraisal";
import type { E2eTraceMeta } from "@/lib/qa/e2e-trace";
import type { AppRole } from "@/lib/auth/roles";

export type RoleType = AppRole;

export type ChatMode = "general_chat" | "recommendation" | "appraisal";
export type ChatFineMode =
  | "general_chat"
  | "recommendation"
  | "clarifying_question"
  | "no_match"
  | "appraisal";

export type SessionMessage = {
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

export type ConversationMemory = {
  summary_text: string;
  stable_facts: string[];
  open_threads: string[];
  last_user_intent: "general_chat" | "recommendation" | "appraisal" | "unknown";
  updated_at: string;
  version: "v1";
};

export type RecommendationReviewAction =
  | "approve"
  | "reject"
  | "regenerate"
  | "override";

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

export type RecommendationReviewState = {
  last_user_message: string | null;
  last_assistant_message: string | null;
  last_recommendations: RecommendationResponse["recommendations"];
  last_questions: string[];
  last_mode: RecommendationResponse["mode"] | null;
  last_notes: string | null;
  decision: "none" | "approved" | "rejected" | "overridden" | "regenerated";
  decision_notes: string | null;
  decision_at: string | null;
  reviewed_by_role: RoleType | null;
  regenerate_count: number;
  override_count: number;
};

export type SessionData = {
  session_id: string;
  tenant_id: string | null;
  role: RoleType;
  chat_history: SessionMessage[];
  conversation_memory: ConversationMemory;
  recommendation_state: RecommendationState;
  trade_context: TradeContext;
  project_context: ProjectContext;
  review_state: RecommendationReviewState;
  created_at: string;
  updated_at: string;
};

export type ChatTurnRequest = {
  session_id?: string;
  role?: RoleType;
  user_role?: RoleType;
  message: string;
  tenant_id?: string;
  trade_client_id?: string;
  trade_preferences?: Record<string, unknown>;
  constraints?: HardConstraints;
  project_context?: Partial<ProjectContext>;
  appraisal_context?: AppraisalInput;
  review_action?: RecommendationReviewAction;
  override?: {
    assistant_message?: string;
    selected_rug_ids?: string[];
    notes?: string;
  };
};

export type ChatTurnHandlerInput = {
  message: string;
  role: RoleType;
  mode: ChatMode;
  session: SessionData;
  ai_context_packet?: import("@/lib/chat/context-packet").ChatAiContextPacket;
  tenant_id: string | null;
  appraisal_context?: AppraisalInput;
  review_action?: RecommendationReviewAction;
  override?: {
    assistant_message?: string;
    selected_rug_ids?: string[];
    notes?: string;
  };
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

export type AppraisalTurnResponse = Omit<AppraisalDraftResponse, "mode"> & {
  mode: "appraisal";
};
