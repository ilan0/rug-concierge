import type { InventoryRug } from "@/lib/types/recommendation";

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
  _inventory: InventoryRug[]
): Promise<RecommendationResponse> {
  // Placeholder until OpenAI integration is wired.
  return {
    mode: "clarifying_question",
    assistant_message: "To narrow this down, what size are you looking for?",
    questions: ["Do you have a target size in mind?"],
    recommendations: [],
    notes: null,
  };
}
