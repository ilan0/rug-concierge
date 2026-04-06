import type { UiChatResponseBody } from "@/lib/types/chat-ui";
import type { ConciergeVariant } from "@/components/concierge/types";
import type { HardConstraints } from "@/lib/types/recommendation";

export type StarterPrompt = {
  id: string;
  label: string;
  message: string;
  constraints?: HardConstraints;
};

export const STARTER_PROMPTS: Record<ConciergeVariant, StarterPrompt[]> = {
  concierge: [
    {
      id: "living-room-anchor",
      label: "Find me a living room rug",
      message: "Help me find a living room anchor rug",
      constraints: {
        size: {
          widthIn: 96,
          lengthIn: 120,
          toleranceIn: 12,
        },
        strictness: {
          size: "prefer",
          colors: "prefer",
          styles: "prefer",
          shape: "prefer",
        },
      },
    },
    {
      id: "range-react",
      label: "Show me the collection",
      message: "Show me a range to react to",
    },
    {
      id: "something-specific",
      label: "I'm looking for something specific",
      message: "I have something specific in mind",
    },
  ],
};

export function toRoomId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function modeLabel(
  mode: UiChatResponseBody["fine_mode"] | UiChatResponseBody["mode"] | undefined
): string | null {
  if (!mode) return null;
  if (mode === "recommendation") return "recommendations";
  if (mode === "clarifying_question") return "clarifying question";
  if (mode === "disambiguation") return "disambiguation";
  if (mode === "no_match") return "no match";
  if (mode === "general_chat") return "general chat";
  return mode;
}

export function toSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}
