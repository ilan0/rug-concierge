import type { RoleType } from "@/lib/chat/types";
import type { HardConstraints } from "@/lib/types/recommendation";
import { PROMPT_LAYER, type PromptLayerId } from "@/lib/prompts/layer-ids";
import { detectResponseLanguage } from "@/lib/ai/language";

type RecommendationLayerRole = "system" | "user";

export type RecommendationPromptSection = {
  id: PromptLayerId;
  role: RecommendationLayerRole;
  text: string;
};

type RecommendationPromptBundleInput = {
  system: string;
  recommendation: string;
  structuredOutput: string;
};

type RecommendationLayerContext = {
  role: RoleType;
  discoveryMode: boolean;
  hasConstraintMismatch: boolean;
  hasThinResultsExpansion: boolean;
  hasChatMemoryContext: boolean;
  hasCustomerContext: boolean;
  hasRecentlyShownContext: boolean;
  hasLikedAttributesContext: boolean;
  hasRecentTurnsContext: boolean;
};

type BuildRecommendationPromptSectionsInput = RecommendationLayerContext & {
  prompts: RecommendationPromptBundleInput;
  chatContext?: {
    structured_state?: unknown;
    conversation_memory?: unknown;
    customer_context?: string[];
    recently_shown_rugs?: Array<{
      id: string;
      label: string;
      colors: string[];
      style: string | null;
      origin: string | null;
    }>;
    liked_attributes?: {
      colors: string[];
      styles: string[];
      origins: string[];
    };
    recent_turns?: unknown[];
  };
  constraint_mismatch?: {
    expanded_from_zero_match: boolean;
    unmet_constraints: string[];
    disclosure_hint: string | null;
  };
  expanded_due_to_thin_results?: boolean;
  inventoryContext: unknown[];
  userMessage: string;
  constraints: HardConstraints;
};

type RecommendationLayerDefinition = {
  id: PromptLayerId;
  role: RecommendationLayerRole;
  include: (input: RecommendationLayerContext) => boolean;
  text: (input: BuildRecommendationPromptSectionsInput) => string;
};

const RECOMMENDATION_LAYER_DEFINITIONS: RecommendationLayerDefinition[] = [
  {
    id: PROMPT_LAYER.taskRecommendation,
    role: "system",
    include: () => true,
    text: () =>
      [
        "Do not open with generic transition language. Start with a request-anchored line that names the customer's actual focus (for example: size, style, color, room, or practical need).",
        "Voice: warm, confident, and tasteful. Sound like a helpful showroom consultant, not a search engine.",
        "Keep it concise: 1-3 short sentences in assistant_message. Avoid robotic filler.",
        "When recommending, highlight one standout reason the top piece is special.",
        "If the customer states an avoid preference (for example: no red, not too busy), do not praise or foreground that avoided direction.",
        "If the customer asks for larger/smaller and exact directional matches are unavailable, say that directly before presenting closest alternatives. Never claim the returned set satisfies a directional request when it does not.",
        "If the customer mentions practical needs (kids, pets, high traffic, easy-clean), include one practical suitability note in the opening or first recommendation reason.",
        "End recommendations with one natural next-step invitation (for example: show more like this, larger, or different color).",
        "Opening behavior guidance:",
        "- Color-led request: acknowledge requested color direction first, then present strongest in-stock matches.",
        "- Style/origin request: acknowledge requested style/origin first, then present closest available pieces.",
        "- Discovery request: acknowledge open browsing intent and present a varied compare set.",
      ].join("\n"),
  },
  {
    id: PROMPT_LAYER.systemBase,
    role: "system",
    include: () => true,
    text: (input) => input.prompts.system,
  },
  {
    id: PROMPT_LAYER.taskRecommendation,
    role: "system",
    include: () => true,
    text: (input) =>
      detectResponseLanguage(input.userMessage) === "es"
        ? "Respond in Spanish. Keep rug titles and IDs exactly as provided."
        : "Respond in English.",
  },
  {
    id: PROMPT_LAYER.taskRecommendation,
    role: "system",
    include: () => true,
    text: (input) => input.prompts.recommendation,
  },
  {
    id: PROMPT_LAYER.structuredRecommendation,
    role: "system",
    include: () => true,
    text: (input) => input.prompts.structuredOutput,
  },
  {
    id: PROMPT_LAYER.contextChatMemory,
    role: "system",
    include: (input) => input.hasChatMemoryContext,
    text: (input) =>
      `CHAT MEMORY CONTEXT:\n${JSON.stringify(
        {
          structured_state: input.chatContext?.structured_state ?? null,
          conversation_memory: input.chatContext?.conversation_memory ?? null,
        },
        null
      )}`,
  },
  {
    id: PROMPT_LAYER.contextChatMemory,
    role: "system",
    include: (input) => input.hasCustomerContext,
    text: (input) =>
      `CUSTOMER CONTEXT (stable facts):\n${JSON.stringify(
        input.chatContext?.customer_context ?? []
      )}`,
  },
  {
    id: PROMPT_LAYER.contextChatMemory,
    role: "system",
    include: (input) => input.hasRecentlyShownContext,
    text: (input) =>
      `RECENTLY SHOWN RUGS (avoid repeating unless clearly requested):\n${JSON.stringify(
        input.chatContext?.recently_shown_rugs ?? []
      )}`,
  },
  {
    id: PROMPT_LAYER.contextChatMemory,
    role: "system",
    include: (input) => input.hasLikedAttributesContext,
    text: (input) =>
      `LIKED ATTRIBUTES (weight these positively):\n${JSON.stringify(
        input.chatContext?.liked_attributes ?? {
          colors: [],
          styles: [],
          origins: [],
        }
      )}`,
  },
  {
    id: PROMPT_LAYER.contextRecentTurns,
    role: "system",
    include: (input) => input.hasRecentTurnsContext,
    text: (input) =>
      `RECENT TURNS CONTEXT:\n${JSON.stringify(
        input.chatContext?.recent_turns ?? []
      )}`,
  },
  {
    id: PROMPT_LAYER.contextInventory,
    role: "system",
    include: () => true,
    text: (input) =>
      `AVAILABLE INVENTORY (authoritative). Each entry includes ID, Label, Size, and Description:\n${JSON.stringify(
        input.inventoryContext
      )}`,
  },
  {
    id: PROMPT_LAYER.latestUserWithConstraints,
    role: "user",
    include: () => true,
    text: (input) =>
      `User request:\n${input.userMessage}\n\nHard constraints:\n${JSON.stringify(
        input.constraints
      )}`,
  },
  {
    id: PROMPT_LAYER.taskRecommendation,
    role: "system",
    include: (input) => input.discoveryMode,
    text: () =>
      "Discovery mode is active. Return recommendations first. Add at most one natural narrowing question only when it materially helps refine the next turn.",
  },
  {
    id: PROMPT_LAYER.taskRecommendation,
    role: "system",
    include: (input) => input.hasConstraintMismatch,
    text: (input) =>
      `Constraint mismatch expansion is active: ${JSON.stringify(
        input.constraint_mismatch ?? null
      )}. You MUST open assistant_message with one concise, honest disclosure that exact matches were unavailable, and that disclosure must appear before any rug descriptions. Keep the tone constructive and helpful, then pivot to what is available.`,
  },
  {
    id: PROMPT_LAYER.taskRecommendation,
    role: "system",
    include: (input) => input.hasThinResultsExpansion,
    text: () =>
      "Thin-results expansion is active. Include one concise disclosure that only a few exact matches were available and similar alternatives are included.",
  },
];

function getRecommendationLayerDefinitions(input: RecommendationLayerContext) {
  return RECOMMENDATION_LAYER_DEFINITIONS.filter((layer) => layer.include(input));
}

export function getRecommendationLayerPreview(
  input: RecommendationLayerContext
): PromptLayerId[] {
  return getRecommendationLayerDefinitions(input).map((layer) => layer.id);
}

export function buildRecommendationPromptSections(
  input: BuildRecommendationPromptSectionsInput
): RecommendationPromptSection[] {
  return getRecommendationLayerDefinitions(input).map((layer) => ({
    id: layer.id,
    role: layer.role,
    text: layer.text(input),
  }));
}

export function groupPromptSectionsByRole(
  sections: RecommendationPromptSection[]
): Array<{
  role: RecommendationLayerRole;
  content: Array<{ type: "input_text"; text: string }>;
}> {
  const grouped: Array<{
    role: RecommendationLayerRole;
    content: Array<{ type: "input_text"; text: string }>;
  }> = [];

  for (const section of sections) {
    const current = grouped[grouped.length - 1];
    if (!current || current.role !== section.role) {
      grouped.push({
        role: section.role,
        content: [{ type: "input_text", text: section.text }],
      });
      continue;
    }

    current.content.push({ type: "input_text", text: section.text });
  }

  return grouped;
}
