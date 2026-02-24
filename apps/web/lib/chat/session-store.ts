import type { RoleType, SessionData } from "@/lib/chat/types";
import {
  appendTurnsToDb,
  loadSessionFromDb,
  upsertSessionToDb,
  type SaveSessionInput,
} from "@/lib/chat/session-repo";

const sessions = new Map<string, SessionData>();

export class SessionTenantMismatchError extends Error {
  constructor(message = "Session tenant_id does not match request tenant_id.") {
    super(message);
    this.name = "SessionTenantMismatchError";
  }
}

function resolveTenantBinding(
  sessionTenantId: string | null,
  requestTenantId: string | null
): string | null {
  if (sessionTenantId && requestTenantId && sessionTenantId !== requestTenantId) {
    throw new SessionTenantMismatchError();
  }
  return requestTenantId ?? sessionTenantId ?? null;
}

function buildEmptySession(sessionId: string, role: RoleType): SessionData {
  const now = new Date().toISOString();
  return {
    session_id: sessionId,
    tenant_id: null,
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
}

export async function getOrCreateSession(
  sessionId: string,
  role: RoleType,
  input: { tenantId: string | null }
): Promise<SessionData> {
  const cached = sessions.get(sessionId);
  if (cached) {
    const tenantId = resolveTenantBinding(cached.tenant_id, input.tenantId);
    if (tenantId !== cached.tenant_id) {
      const next = { ...cached, tenant_id: tenantId };
      sessions.set(sessionId, next);
      return next;
    }
    return cached;
  }

  const fromDb = await loadSessionFromDb(sessionId);
  if (fromDb) {
    const tenantId = resolveTenantBinding(fromDb.tenantId, input.tenantId);
    const next: SessionData =
      fromDb.session.tenant_id === tenantId
        ? fromDb.session
        : { ...fromDb.session, tenant_id: tenantId };
    sessions.set(sessionId, next);
    return next;
  }

  const session = {
    ...buildEmptySession(sessionId, role),
    tenant_id: input.tenantId ?? null,
  };
  await upsertSessionToDb(session, { tenantId: input.tenantId });
  sessions.set(sessionId, session);
  return session;
}

export async function saveSession(
  session: SessionData,
  input: SaveSessionInput
): Promise<void> {
  const tenantId = resolveTenantBinding(session.tenant_id, input.tenantId);
  const next: SessionData =
    tenantId === session.tenant_id
      ? session
      : {
          ...session,
          tenant_id: tenantId,
        };
  sessions.set(session.session_id, next);
  const persisted = await upsertSessionToDb(next, { tenantId });
  if (!persisted) return;
  await appendTurnsToDb(next.session_id, {
    ...input,
    tenantId,
  });
}
