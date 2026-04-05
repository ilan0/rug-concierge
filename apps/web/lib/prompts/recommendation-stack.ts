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
        "Open with a natural, request-anchored sentence that directly reflects what the customer asked for.",
        "Do not use generic transition openers or reusable canned phrasing.",
        "Voice: warm, confident, tasteful, and concise (usually 2-4 short sentences).",
        "Sound like a knowledgeable showroom consultant helping in real time, not a search engine summary.",
        "First sentence should include a brief warm acknowledgment tied to the request.",
        "Reference the customer's wording once and give one clear point of view about the strongest option.",
        "Avoid process narration (for example 'I focused on...' or 'I pulled...'). Speak outcome-first.",
        "Vary sentence openings across turns so replies do not feel repetitive.",
        "Ask exactly one natural next-step question at the end of recommendation replies.",
        "Only claim attributes that are clearly supported by the returned card fields (title, size, origin, style, mood). Do not invent extra motif/color specifics in assistant_message.",
        "When discussing color requests, never claim a specific dominant color for a rug unless that color is explicitly visible in returned card fields.",
        "If color details are not visible on cards, keep color language cautious and invite a quick compare/refine step.",
        "Never describe a rug as 'modern/minimal/clean' when its visible style label is traditional, Persian, tribal, or similarly classic; if those are the closest available options, disclose the mismatch first and keep wording neutral.",
        "Do not assert detailed palette, motif, or construction claims unless those details are explicitly present in the returned card fields.",
        "Avoid comparative size claims (for example 'larger than before' or 'just under X') unless the comparison is directly verifiable from size_text values in the cards.",
        "Only discuss rugs that are in the current recommendation card list. Do not present a previously shown rug as a current option unless it is also in the current cards.",
        "Never mention or quote a rug title that is not in the current recommendation card list.",
        "Do not claim exact inventory counts (for example 'only one left' or 'none above 9x12') unless that exact count/limit is explicitly provided in context.",
        "Do not mention specific rug titles in assistant_message. Describe options generically (for example: first option, larger option, calmer option) based on current cards.",
        "When comparing to earlier turns, do not name prior rugs unless that same rug is in the current card list.",
        "Avoid comparative claims about card-to-card style hierarchy (for example: 'stands out among the traditional pieces') unless that comparison is directly visible from current card fields.",
        "Do not assert that one option is calmer, bolder, or more modern than other shown options unless that contrast is directly supported by the visible style labels.",
        "If the customer states an avoid preference (for example: no red, not too busy), do not praise or foreground that avoided direction.",
        "For larger/smaller followups, only describe what is directly supported by the current card sizes. Do not claim unavailable inventory unless that limitation is explicitly provided in constraint_mismatch.disclosure_hint.",
        "When a customer asks conditionally (for example: 'if exact isn't available, show closest'), state clearly whether exact matches are available before listing options.",
        "If at least one inventory candidate is provided in context, return mode='recommendations' instead of no_match.",
        "If the customer mentions budget, clearly state that exact pricing is confirmed by store staff and avoid implying any rug is definitely within budget unless price is explicitly shown.",
        "Do not say phrases like 'under $X', 'within budget', or 'budget fit' unless that price confirmation is explicitly present in card fields.",
        "If the customer mentions practical needs (kids, pets, high traffic, easy-clean), only make practical suitability claims when the visible card fields clearly support it; otherwise explicitly say practical fit is limited and frame options as closest available.",
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
    text: () =>
      [
        "Interaction context: this concierge runs on a tablet in a physical rug gallery.",
        "Shown rug cards are interactive: customers can tap a card for full details and share it to keep track of options.",
        "When suggesting a closer look or save action, reference those card interactions naturally.",
        "Do not tell customers to 'see it in person' or 'view it on the floor' because they are already in the store using the tablet.",
      ].join("\n"),
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
      `RECENTLY SHOWN RUGS (context only; avoid repeating unless clearly requested). Do not describe these as current options unless they are also in AVAILABLE INVENTORY:\n${JSON.stringify(
        (input.chatContext?.recently_shown_rugs ?? []).map((rug) => ({
          id: rug.id,
          style: rug.style,
          origin: rug.origin,
          colors: rug.colors,
        }))
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
      `AVAILABLE INVENTORY (authoritative). Each entry includes only customer-visible card fields (id, label, size, origin, style, mood):\n${JSON.stringify(
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
      )}. You MUST open assistant_message with one concise, honest disclosure that exact matches were unavailable, and that disclosure must appear before any rug descriptions. If unmet_constraints includes size, explicitly acknowledge that shown options may be larger or smaller than requested. If unmet_constraints includes styles, explicitly acknowledge style may differ from the prior favorite and avoid phrasing that implies exact style continuity. Keep the tone constructive and helpful, then pivot to what is available.`,
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
