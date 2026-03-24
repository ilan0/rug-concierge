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
  customer_context: string[];
  structured_state: {
    recommendation_state: SessionData["recommendation_state"];
  };
  recently_shown_rugs: Array<{
    id: string;
    label: string;
    colors: string[];
    style: string | null;
    origin: string | null;
  }>;
  liked_attributes: {
    colors: string[];
    styles: string[];
    origins: string[];
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
  const runtime = input.session.recommendation_state.runtime ?? {};
  return {
    conversation_memory: toAiMemoryPacket(input.session.conversation_memory),
    customer_context: (input.session.conversation_memory.stable_facts ?? []).slice(0, 12),
    structured_state: {
      recommendation_state: input.session.recommendation_state,
    },
    recently_shown_rugs: Array.isArray(runtime.recently_shown_rugs)
      ? runtime.recently_shown_rugs.slice(0, 10)
      : [],
    liked_attributes: {
      colors: Array.isArray(runtime.liked_attributes?.colors)
        ? runtime.liked_attributes.colors.slice(0, 8)
        : [],
      styles: Array.isArray(runtime.liked_attributes?.styles)
        ? runtime.liked_attributes.styles.slice(0, 8)
        : [],
      origins: Array.isArray(runtime.liked_attributes?.origins)
        ? runtime.liked_attributes.origins.slice(0, 8)
        : [],
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
  const customerContextChars = totalChars(packet.customer_context);
  const recentlyShownChars = totalChars(
    packet.recently_shown_rugs.map((rug) =>
      [rug.id, rug.label, ...(rug.colors ?? []), rug.style ?? "", rug.origin ?? ""]
        .join(" ")
        .trim()
    )
  );
  const likedAttributesChars = totalChars([
    ...packet.liked_attributes.colors,
    ...packet.liked_attributes.styles,
    ...packet.liked_attributes.origins,
  ]);
  const total =
    packet.conversation_memory.summary_text.length +
    stableFactChars +
    openThreadChars +
    customerContextChars +
    recentlyShownChars +
    likedAttributesChars +
    recentTurnChars +
    packet.latest_user_message.length;

  return {
    field_counts: {
      stable_facts: packet.conversation_memory.stable_facts.length,
      open_threads: packet.conversation_memory.open_threads.length,
      customer_context: packet.customer_context.length,
      recently_shown_rugs: packet.recently_shown_rugs.length,
      recent_turns: packet.recent_turns.length,
    },
    char_counts: {
      summary_text: packet.conversation_memory.summary_text.length,
      stable_facts_total: stableFactChars,
      open_threads_total: openThreadChars,
      customer_context_total: customerContextChars,
      recently_shown_total: recentlyShownChars,
      liked_attributes_total: likedAttributesChars,
      recent_turns_total: recentTurnChars,
      latest_user_message: packet.latest_user_message.length,
      total,
    },
  };
}
