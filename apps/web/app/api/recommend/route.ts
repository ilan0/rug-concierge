import { NextResponse } from "next/server";
import { filterByHardConstraints } from "@/lib/filters/hard-constraints";
import { rankAndExplain } from "@/lib/ai/recommend";
import type { HardConstraints, InventoryRug } from "@/lib/types/recommendation";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const constraints = (body.constraints ?? {}) as HardConstraints;

  // TODO: Replace with Supabase query.
  const inventory: InventoryRug[] = [];

  const candidates = filterByHardConstraints(inventory, constraints);

  if (candidates.length === 0) {
    return NextResponse.json({
      mode: "no_match",
      assistant_message:
        "Based on current inventory, nothing fits those constraints.",
      questions: ["Would you like to adjust size or budget?"],
      recommendations: [],
      notes: null,
    });
  }

  const response = await rankAndExplain(candidates);
  return NextResponse.json(response);
}
