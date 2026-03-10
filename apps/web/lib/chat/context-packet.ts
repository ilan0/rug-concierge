import { toAiMemoryPacket } from "@/lib/chat/memory";
import type { SessionData } from "@/lib/chat/types";

const RECENT_TURNS_LIMIT = 4;
const RECENT_TURN_MAX_CHARS = 280;

type RecentTurn = {
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

export type ChatAiContextPacket = {
  conversation_memory: ReturnType<typeof toAiMemoryPacket>;
  structured_state: {
    recommendation_state: SessionData["recommendation_state"];
  };
  recent_turns: RecentTurn[];
  latest_user_message: string;
};

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function trimToChars(value: string, maxChars: number): string {
  const normalized = normalizeText(value);
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars - 1).trimEnd()}…`;
}

function toRecentTurns(session: SessionData): RecentTurn[] {
  const turns = session.chat_history.slice(-RECENT_TURNS_LIMIT);
  return turns.map((turn) => ({
    role: turn.role,
    content: trimToChars(turn.content, RECENT_TURN_MAX_CHARS),
    created_at: turn.created_at,
  }));
}

export function buildAiContextPacket(input: {
  session: SessionData;
  latestUserMessage: string;
}): ChatAiContextPacket {
  return {
    conversation_memory: toAiMemoryPacket(input.session.conversation_memory),
    structured_state: {
      recommendation_state: input.session.recommendation_state,
    },
    recent_turns: toRecentTurns(input.session),
    latest_user_message: input.latestUserMessage,
  };
}

function totalChars(values: string[]): number {
  return values.reduce((sum, value) => sum + value.length, 0);
}

export function getAiContextPacketStats(packet: ChatAiContextPacket) {
  const stableFactChars = totalChars(packet.conversation_memory.stable_facts);
  const openThreadChars = totalChars(packet.conversation_memory.open_threads);
  const recentTurnChars = totalChars(packet.recent_turns.map((turn) => turn.content));
  const total =
    packet.conversation_memory.summary_text.length +
    stableFactChars +
    openThreadChars +
    recentTurnChars +
    packet.latest_user_message.length;

  return {
    field_counts: {
      stable_facts: packet.conversation_memory.stable_facts.length,
      open_threads: packet.conversation_memory.open_threads.length,
      recent_turns: packet.recent_turns.length,
    },
    char_counts: {
      summary_text: packet.conversation_memory.summary_text.length,
      stable_facts_total: stableFactChars,
      open_threads_total: openThreadChars,
      recent_turns_total: recentTurnChars,
      latest_user_message: packet.latest_user_message.length,
      total,
    },
  };
}
