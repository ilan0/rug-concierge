import type { RoleType } from "@/lib/chat/types";
import type { PromptLayerId } from "@/lib/prompts/layer-ids";
import { PROMPT_LAYER } from "@/lib/prompts/layer-ids";
import type { ChatAiContextPacket } from "@/lib/chat/context-packet";
import { detectResponseLanguage } from "@/lib/ai/language";

type GeneralChatLayerRole = "system" | "user";

export type GeneralChatPromptSection = {
  id: PromptLayerId;
  role: GeneralChatLayerRole;
  text: string;
};

type GeneralChatLayerContext = {
  role: RoleType;
  hasStructuredStateContext: boolean;
  hasMemoryContext: boolean;
  hasRecentTurns: boolean;
};

type BuildGeneralChatPromptSectionsInput = GeneralChatLayerContext & {
  prompts: {
    system: string;
    generalChat: string;
  };
  contextPacket: ChatAiContextPacket;
  rolePrompt: string;
};

type GeneralChatLayerDefinition = {
  id: PromptLayerId;
  role: GeneralChatLayerRole;
  include: (input: GeneralChatLayerContext) => boolean;
  text: (input: BuildGeneralChatPromptSectionsInput) => string;
};

export function getRolePrompt(role: RoleType): string {
  if (role === "store_staff" || role === "developer") {
    return "Role: store staff. Be operational, accurate, and efficient for store workflows.";
  }

  return "Role: retail customer. Be approachable, warm, and concise, with practical guidance and a natural next step.";
}

const GENERAL_CHAT_LAYER_DEFINITIONS: GeneralChatLayerDefinition[] = [
  {
    id: PROMPT_LAYER.systemBase,
    role: "system",
    include: () => true,
    text: (input) => input.prompts.system,
  },
  {
    id: PROMPT_LAYER.taskGeneral,
    role: "system",
    include: () => true,
    text: (input) => input.prompts.generalChat,
  },
  {
    id: PROMPT_LAYER.taskGeneral,
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
    id: PROMPT_LAYER.taskGeneral,
    role: "system",
    include: () => true,
    text: () =>
      "If the customer signals purchase intent, acknowledge the selected rug briefly, hand pricing/checkout to store staff, and immediately invite continued browsing so the conversation stays open.",
  },
  {
    id: PROMPT_LAYER.taskGeneral,
    role: "system",
    include: () => true,
    text: (input) =>
      detectResponseLanguage(input.contextPacket.latest_user_message) === "es"
        ? "Respond in Spanish."
        : "Respond in English.",
  },
  {
    id: PROMPT_LAYER.roleRetail,
    role: "system",
    include: (input) => input.role === "retail_customer",
    text: (input) => input.rolePrompt,
  },
  {
    id: PROMPT_LAYER.roleStaff,
    role: "system",
    include: (input) => input.role === "store_staff" || input.role === "developer",
    text: (input) => input.rolePrompt,
  },
  {
    id: PROMPT_LAYER.contextStructuredState,
    role: "system",
    include: (input) => input.hasStructuredStateContext,
    text: (input) =>
      `STRUCTURED STATE CONTEXT:\n${JSON.stringify(
        input.contextPacket.structured_state,
        null,
        2
      )}`,
  },
  {
    id: PROMPT_LAYER.contextChatMemory,
    role: "system",
    include: (input) => input.hasMemoryContext,
    text: (input) =>
      `CHAT MEMORY CONTEXT:\n${JSON.stringify(
        input.contextPacket.conversation_memory,
        null,
        2
      )}`,
  },
  {
    id: PROMPT_LAYER.contextRecentTurns,
    role: "system",
    include: (input) => input.hasRecentTurns,
    text: (input) =>
      `RECENT TURNS CONTEXT:\n${JSON.stringify(input.contextPacket.recent_turns, null, 2)}`,
  },
  {
    id: PROMPT_LAYER.latestUserMessage,
    role: "user",
    include: () => true,
    text: (input) => input.contextPacket.latest_user_message,
  },
];

function getLayerDefinitions(input: GeneralChatLayerContext) {
  return GENERAL_CHAT_LAYER_DEFINITIONS.filter((layer) => layer.include(input));
}

export function getGeneralChatLayerPreview(
  input: GeneralChatLayerContext
): PromptLayerId[] {
  return getLayerDefinitions(input).map((layer) => layer.id);
}

export function buildGeneralChatPromptSections(
  input: BuildGeneralChatPromptSectionsInput
): GeneralChatPromptSection[] {
  return getLayerDefinitions(input).map((layer) => ({
    id: layer.id,
    role: layer.role,
    text: layer.text(input),
  }));
}

export function groupGeneralChatSectionsByRole(
  sections: GeneralChatPromptSection[]
): Array<{
  role: GeneralChatLayerRole;
  content: Array<{ type: "input_text"; text: string }>;
}> {
  const grouped: Array<{
    role: GeneralChatLayerRole;
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
