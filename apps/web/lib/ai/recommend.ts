import type { HardConstraints, InventoryRug } from "@/lib/types/recommendation";

// PSEUDOCODE
// If no candidates -> no_match
// Else call OpenAI to rank/explain (TODO)
// Return structured response

export type RecommendationResponse = {
  mode: "recommendations" | "clarifying_question" | "no_match";
  assistant_message: string;
  questions: string[];
  recommendations: {
    rug_id: string;
    sku: string | null;
    title: string;
    size_text: string | null;
    price_usd: number | null;
    match_reasons: string[];
    confidence: number;
  }[];
  notes: string | null;
};

export async function rankAndExplain(
  inventory: InventoryRug[],
  _constraints: HardConstraints
): Promise<RecommendationResponse> {
  // PSEUDO LOGIC (no OpenAI yet):
  // 1) If inventory is empty after filtering, return no_match.
  // 2) Otherwise, return recommendations (stub for now).

  if (inventory.length === 0) {
    return {
      mode: "no_match",
      assistant_message:
        "Based on current inventory, nothing fits those constraints.",
      questions: ["Would you like to adjust size or budget?"],
      recommendations: [],
      notes: null,
    };
  }

  return {
    mode: "recommendations",
    assistant_message:
      "Based on what you’re looking for, here are a few rugs that could work well:",
    questions: [],
    recommendations: [
      // TODO: Replace with ranked results from OpenAI.
    ],
    notes: null,
  };
}
