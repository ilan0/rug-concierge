import { rankAndExplain } from "@/lib/ai/recommend";
import { shapeCandidatesForAI } from "@/lib/filters/candidate-shaping";
import { filterByHardConstraints } from "@/lib/filters/hard-constraints";
import type {
  ChatTurnHandlerInput,
  RecommendationTurnResponse,
} from "@/lib/chat/types";
import type { InventoryRug } from "@/lib/types/recommendation";

// Recommendation mode handler uses persistent session constraints plus current inventory.
export async function handleRecommendationTurn(
  input: ChatTurnHandlerInput
): Promise<RecommendationTurnResponse> {
  const inventory = normalizeInventory(input.inventory);
  const constraints = input.session.recommendation_state.hard_constraints;

  const filtered = filterByHardConstraints(inventory, constraints);
  const shaped = shapeCandidatesForAI(filtered);
  const aiResponse = await rankAndExplain(shaped, constraints, input.message);

  return {
    ...aiResponse,
    mode:
      aiResponse.mode === "recommendations"
        ? "recommendation"
        : aiResponse.mode,
  };
}

function normalizeInventory(rows: InventoryRug[]): InventoryRug[] {
  return rows.filter((row) => typeof row.id === "string" && typeof row.label === "string");
}

