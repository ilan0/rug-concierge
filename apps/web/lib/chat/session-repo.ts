import type {
  ChatMode,
  SessionData,
  SessionMessage,
} from "@/lib/chat/types";
import { supabaseAdmin } from "@/lib/supabase/admin";

const CHAT_SESSIONS_TABLE = "chat_sessions";
const CHAT_MESSAGES_TABLE = "chat_messages";

const warningCache = new Set<string>();

type PersistTurn = Pick<SessionMessage, "role" | "content" | "created_at">;

export type SaveSessionInput = {
  tenantId: string | null;
  mode: ChatMode;
  turns: PersistTurn[];
};

export type LoadedSessionRecord = {
  session: SessionData;
  tenantId: string | null;
};

function warnOnce(key: string, message: string): void {
  if (warningCache.has(key)) return;
  warningCache.add(key);
  console.warn(`[chat-session-persistence] ${message}`);
}

function toSessionDataOrNull(value: unknown): SessionData | null {
  if (!value || typeof value !== "object") return null;
  const maybe = value as Partial<SessionData>;
  if (
    typeof maybe.session_id !== "string" ||
    typeof maybe.role !== "string" ||
    !Array.isArray(maybe.chat_history) ||
    typeof maybe.created_at !== "string" ||
    typeof maybe.updated_at !== "string"
  ) {
    return null;
  }
  return value as SessionData;
}

export async function loadSessionFromDb(
  sessionId: string
): Promise<LoadedSessionRecord | null> {
  const { data, error } = await supabaseAdmin
    .from(CHAT_SESSIONS_TABLE)
    .select("tenant_id, session_data")
    .eq("session_id", sessionId)
    .maybeSingle();

  if (error) {
    // Most common early-phase error is missing table before migration runs.
    warnOnce(
      "load-session-failed",
      `Unable to load session from DB (${error.message}). Falling back to in-memory session store.`
    );
    return null;
  }

  const session = toSessionDataOrNull(data?.session_data);
  if (!session) return null;

  const tenantId =
    typeof data?.tenant_id === "string" && data.tenant_id.trim().length > 0
      ? data.tenant_id.trim()
      : null;

  const normalizedSession: SessionData = {
    ...session,
    tenant_id: session.tenant_id ?? tenantId,
  };

  return {
    session: normalizedSession,
    tenantId,
  };
}

export async function upsertSessionToDb(
  session: SessionData,
  input: { tenantId: string | null }
): Promise<boolean> {
  const { error } = await supabaseAdmin.from(CHAT_SESSIONS_TABLE).upsert(
    {
      session_id: session.session_id,
      tenant_id: input.tenantId,
      role: session.role,
      session_data: session,
      created_at: session.created_at,
      updated_at: session.updated_at,
    },
    { onConflict: "session_id" }
  );

  if (error) {
    warnOnce(
      "upsert-session-failed",
      `Unable to persist session to DB (${error.message}). Falling back to in-memory session store.`
    );
    return false;
  }

  return true;
}

export async function appendTurnsToDb(
  sessionId: string,
  input: SaveSessionInput
): Promise<boolean> {
  if (input.turns.length === 0) return true;

  const rows = input.turns.map((turn) => ({
    session_id: sessionId,
    tenant_id: input.tenantId,
    role: turn.role,
    mode: input.mode,
    content: turn.content,
    created_at: turn.created_at,
    metadata: {},
  }));

  const { error } = await supabaseAdmin.from(CHAT_MESSAGES_TABLE).insert(rows);
  if (error) {
    warnOnce(
      "append-turns-failed",
      `Unable to persist chat turns to DB (${error.message}). Continuing without turn history persistence.`
    );
    return false;
  }

  return true;
}
