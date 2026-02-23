import type { RoleType, SessionData } from "@/lib/chat/types";

// Placeholder session store for architecture scaffolding.
// Replace with Redis/Postgres-backed store for production.
const sessions = new Map<string, SessionData>();

export function getOrCreateSession(sessionId: string, role: RoleType): SessionData {
  const existing = sessions.get(sessionId);
  if (existing) return existing;

  const now = new Date().toISOString();
  const session: SessionData = {
    session_id: sessionId,
    role,
    created_at: now,
    updated_at: now,
    chat_history: [],
    recommendation_state: {
      hard_constraints: {},
      soft_preferences: {},
    },
    trade_context: {
      tenant_id: null,
      trade_client_id: null,
      preferences: {},
      preferences_source: "none",
    },
    project_context: {
      project_id: null,
      name: null,
      active_room_id: null,
      rooms: [],
      notes: [],
    },
    review_state: {
      last_user_message: null,
      last_assistant_message: null,
      last_recommendations: [],
      last_questions: [],
      last_mode: null,
      last_notes: null,
      decision: "none",
      decision_notes: null,
      decision_at: null,
      reviewed_by_role: null,
      regenerate_count: 0,
      override_count: 0,
    },
  };

  sessions.set(sessionId, session);
  return session;
}

export function saveSession(session: SessionData): void {
  sessions.set(session.session_id, session);
}
