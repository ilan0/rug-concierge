import type { RoleType } from "@/lib/chat/types";
import type { HardConstraints } from "@/lib/types/recommendation";
import { PROMPT_LAYER, type PromptLayerId } from "@/lib/prompts/layer-ids";

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
  tradeSupport: string;
};

type RecommendationLayerContext = {
  role: RoleType;
  hasTradePreferences: boolean;
};

type BuildRecommendationPromptSectionsInput = RecommendationLayerContext & {
  prompts: RecommendationPromptBundleInput;
  tradePreferences?: Record<string, unknown>;
  inventoryContext: unknown[];
  userMessage: string;
  constraints: HardConstraints;
  projectContext: unknown | null;
};

type RecommendationLayerDefinition = {
  id: PromptLayerId;
  role: RecommendationLayerRole;
  include: (input: RecommendationLayerContext) => boolean;
  text: (input: BuildRecommendationPromptSectionsInput) => string;
};

const RECOMMENDATION_LAYER_DEFINITIONS: RecommendationLayerDefinition[] = [
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
    text: (input) => input.prompts.recommendation,
  },
  {
    id: PROMPT_LAYER.structuredRecommendation,
    role: "system",
    include: () => true,
    text: (input) => input.prompts.structuredOutput,
  },
  {
    id: PROMPT_LAYER.taskTradeSupport,
    role: "system",
    include: (input) => input.role === "trade_client",
    text: (input) => input.prompts.tradeSupport,
  },
  {
    id: PROMPT_LAYER.contextTradePreferences,
    role: "system",
    include: (input) => input.hasTradePreferences,
    text: (input) =>
      `TRADE PREFERENCES (soft signals only):\n${JSON.stringify(
        input.tradePreferences ?? {},
        null,
        2
      )}`,
  },
  {
    id: PROMPT_LAYER.contextInventory,
    role: "system",
    include: () => true,
    text: (input) =>
      `AVAILABLE INVENTORY (authoritative):\n${JSON.stringify(
        input.inventoryContext,
        null,
        2
      )}`,
  },
  {
    id: PROMPT_LAYER.latestUserWithConstraints,
    role: "user",
    include: () => true,
    text: (input) =>
      `User request:\n${input.userMessage}\n\nHard constraints:\n${JSON.stringify(
        input.constraints
      )}\n\nProject context:\n${JSON.stringify(input.projectContext)}`,
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
