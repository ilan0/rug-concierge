import { NextResponse } from "next/server";
import { filterByHardConstraints } from "@/lib/filters/hard-constraints";
import { rankAndExplain } from "@/lib/ai/recommend";
import type { HardConstraints, InventoryRug } from "@/lib/types/recommendation";

// PSEUDOCODE
// 1) Parse request + constraints
// 2) If missing size/budget -> clarifying_question
// 3) Query inventory (TODO)
// 4) Apply hard constraints
// 5) If empty -> no_match, else rank/explain

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const constraints = (body.constraints ?? {}) as HardConstraints;

  const missingSize = !constraints.size;
  const missingBudget = typeof constraints.budgetMax !== "number";

  if (missingSize || missingBudget) {
    const questions: string[] = [];
    if (missingSize) questions.push("Do you have a target size in mind?");
    if (missingBudget) questions.push("Do you have a target budget range?");

    return NextResponse.json({
      mode: "clarifying_question",
      assistant_message:
        "To narrow this down, I need a bit more information.",
      questions,
      recommendations: [],
      notes: null,
    });
  }

  // TODO: Replace with Supabase query.
  // PSEUDOCODE (size tolerance query):
  // if constraints.size:
  //   minW = widthIn - tolerance
  //   maxW = widthIn + tolerance
  //   minL = lengthIn - tolerance
  //   maxL = lengthIn + tolerance
  //   query rugs where (width_total_in between minW..maxW AND length_total_in between minL..maxL)
  //   OR (width_total_in between minL..maxL AND length_total_in between minW..maxW) for rotation
  const inventory: InventoryRug[] = [];

  const candidates = filterByHardConstraints(inventory, constraints);

  const response = await rankAndExplain(candidates, constraints);
  return NextResponse.json(response);
}
