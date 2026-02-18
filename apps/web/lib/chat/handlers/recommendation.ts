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
  const globalConstraints = input.session.recommendation_state.hard_constraints;
  const activeRoom = input.session.project_context.active_room_id
    ? input.session.project_context.rooms.find(
        (room) => room.room_id === input.session.project_context.active_room_id
      ) ?? null
    : null;
  const constraints = {
    ...globalConstraints,
    ...(activeRoom?.constraints ?? {}),
  };

  const filtered = filterByHardConstraints(inventory, constraints);
  const shaped = shapeCandidatesForAI(filtered);
  const aiResponse = await rankAndExplain(shaped, constraints, input.message, {
    role: input.role,
    trade_preferences:
      input.role === "trade_client"
        ? input.session.trade_context.preferences
        : undefined,
    project_context: {
      project_name: input.session.project_context.name,
      active_room: activeRoom?.room_name ?? null,
      room_count: input.session.project_context.rooms.length,
      rooms: input.session.project_context.rooms.map((room) => ({
        room_name: room.room_name,
        constraints: room.constraints,
      })),
    },
  });

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
