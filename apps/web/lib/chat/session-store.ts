import type { RoleType, SessionData } from "@/lib/chat/types";
import {
  buildInitialConversationMemory,
  ensureConversationMemory,
  trimChatHistory,
} from "@/lib/chat/memory";
import {
  appendTurnsToDb,
  loadSessionFromDb,
  upsertSessionToDb,
  type SaveSessionInput,
} from "@/lib/chat/session-repo";

const sessions = new Map<string, SessionData>();
const sessionLocks = new Map<string, Promise<void>>();
const MAX_IN_MEMORY_SESSIONS = (() => {
  const raw = Number.parseInt(process.env.MAX_IN_MEMORY_SESSIONS ?? "", 10);
  if (!Number.isFinite(raw) || raw < 50) return 500;
  return raw;
})();

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
    conversation_memory: buildInitialConversationMemory(now),
    recommendation_state: {
      hard_constraints: {},
      soft_preferences: {},
    },
  };
}

function normalizeSessionDataShape(session: SessionData): SessionData {
  return {
    ...session,
    chat_history: trimChatHistory(session.chat_history),
    conversation_memory: ensureConversationMemory(session.conversation_memory),
  };
}

function writeToSessionCache(sessionId: string, session: SessionData): void {
  // Keep insertion order as LRU by deleting+setting on every touch.
  sessions.delete(sessionId);
  sessions.set(sessionId, session);

  while (sessions.size > MAX_IN_MEMORY_SESSIONS) {
    const oldestKey = sessions.keys().next().value;
    if (typeof oldestKey !== "string") break;
    sessions.delete(oldestKey);
  }
}

async function withSessionLock<T>(
  sessionId: string,
  work: () => Promise<T>
): Promise<T> {
  const previous = sessionLocks.get(sessionId) ?? Promise.resolve();
  let releaseCurrent!: () => void;
  const current = new Promise<void>((resolve) => {
    releaseCurrent = resolve;
  });
  const chained = previous.then(() => current);
  sessionLocks.set(sessionId, chained);

  await previous;
  try {
    return await work();
  } finally {
    releaseCurrent();
    if (sessionLocks.get(sessionId) === chained) {
      sessionLocks.delete(sessionId);
    }
  }
}

export async function getOrCreateSession(
  sessionId: string,
  role: RoleType,
  input: { tenantId: string | null }
): Promise<SessionData> {
  return withSessionLock(sessionId, async () => {
    const cached = sessions.get(sessionId);
    if (cached) {
      const tenantId = resolveTenantBinding(cached.tenant_id, input.tenantId);
      if (tenantId !== cached.tenant_id) {
        const next = { ...cached, tenant_id: tenantId };
        writeToSessionCache(sessionId, next);
        return next;
      }
      writeToSessionCache(sessionId, cached);
      return cached;
    }

    const fromDb = await loadSessionFromDb(sessionId);
    if (fromDb) {
      const tenantId = resolveTenantBinding(fromDb.tenantId, input.tenantId);
      const hydrated: SessionData =
        fromDb.session.tenant_id === tenantId
          ? fromDb.session
          : { ...fromDb.session, tenant_id: tenantId };
      const next = normalizeSessionDataShape(hydrated);
      writeToSessionCache(sessionId, next);
      return next;
    }

    const session = {
      ...buildEmptySession(sessionId, role),
      tenant_id: input.tenantId ?? null,
    };
    await upsertSessionToDb(session, { tenantId: input.tenantId });
    writeToSessionCache(sessionId, session);
    return session;
  });
}

export async function saveSession(
  session: SessionData,
  input: SaveSessionInput
): Promise<void> {
  await withSessionLock(session.session_id, async () => {
    const normalized = normalizeSessionDataShape(session);
    const tenantId = resolveTenantBinding(session.tenant_id, input.tenantId);
    const next: SessionData =
      tenantId === normalized.tenant_id
        ? normalized
        : {
            ...normalized,
            tenant_id: tenantId,
          };
    writeToSessionCache(session.session_id, next);
    const persisted = await upsertSessionToDb(next, { tenantId });
    if (!persisted) return;
    await appendTurnsToDb(next.session_id, {
      ...input,
      tenantId,
    });
  });
}

export function deleteSessionFromMemory(sessionId: string): void {
  sessions.delete(sessionId);
}
