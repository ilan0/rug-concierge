import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { badRequest, internalError } from "@/lib/errors/http-errors";
import { resolveAuthoritativeTenantForServer } from "@/lib/auth/tenant";
import { fetchPrimaryRugImagesForRugs } from "@/lib/storage/rug-images";
import {
  aiStructuredFieldsSchema,
  staffOverridesSchema,
} from "@/lib/inventory/schemas";
import { resolveEffectiveFields } from "@/lib/inventory/resolve-fields";
import { formatRugSize } from "@/lib/utils/format";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

function toPlainText(value: string): string {
  return value
    .replace(/\*\*/g, "")
    .replace(/[_`#]/g, "")
    .replace(/^\s*[-*•]+\s*/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractOutputText(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const data = payload as Record<string, unknown>;

  if (typeof data.output_text === "string" && data.output_text.trim()) {
    return data.output_text;
  }

  if (!Array.isArray(data.output)) return null;

  for (const outputItem of data.output) {
    if (!outputItem || typeof outputItem !== "object") continue;
    const item = outputItem as Record<string, unknown>;
    if (!Array.isArray(item.content)) continue;

    for (const part of item.content) {
      if (!part || typeof part !== "object") continue;
      const block = part as Record<string, unknown>;
      if (typeof block.text === "string" && block.text.trim()) {
        return block.text;
      }
    }
  }

  return null;
}

async function generateContextualBlurb(input: {
  intakeLabel: string | null;
  sizeDisplay: string;
  aiDescription: string | null;
}): Promise<string> {
  const labelForPrompt =
    typeof input.intakeLabel === "string" && input.intakeLabel.trim().length > 0
      ? input.intakeLabel
      : `Rug ${input.sizeDisplay}`;
  const fallback = toPlainText(
    `${labelForPrompt} has a distinct character that can anchor a living room or bedroom. Ask staff for placement and care guidance based on your traffic level and lifestyle.`
  );

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return fallback;

  const requestPayload = {
    model: "gpt-4o-mini",
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text:
              "You are a knowledgeable rug consultant speaking directly to a customer. Given the following rug information, write 2-3 sentences of helpful context. Cover: the rug's style tradition or character, what interior aesthetics or rooms it suits best, and one brief care consideration. Be warm, specific, and concise. Plain text only, no markdown.",
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: `Label: ${labelForPrompt}\nDescription: ${
              input.aiDescription ?? "No description available"
            }`,
          },
        ],
      },
    ],
    max_output_tokens: 220,
  };

  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestPayload),
  }).catch(() => null);

  if (!response || !response.ok) return fallback;

  const payload = (await response.json().catch(() => null)) as unknown;
  const outputText = extractOutputText(payload);
  if (!outputText) return fallback;

  const normalized = toPlainText(outputText);
  return normalized || fallback;
}

function toAiStructuredFields(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const parsed = aiStructuredFieldsSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function toStaffOverrides(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const parsed = staffOverridesSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  if (!id || typeof id !== "string") {
    return badRequest("rug id is required.");
  }

  const tenantId = resolveAuthoritativeTenantForServer({});
  if (!tenantId) {
    return internalError("Tenant is not configured.");
  }

  const runRugQuery = (columns: string) =>
    supabaseAdmin
      .from("rugs")
      .select(columns)
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .maybeSingle();

  const selectCandidates = [
    "id, intake_label, ai_structured_fields, staff_overrides, ai_description, width_total_in, length_total_in, status",
    "id, intake_label, ai_structured_fields, ai_description, width_total_in, length_total_in, status",
    "id, intake_label, ai_description, width_total_in, length_total_in, status",
  ];

  let rugResult = await runRugQuery(selectCandidates[0]);
  for (const selectColumns of selectCandidates.slice(1)) {
    if (!rugResult.error) break;
    if (!isLikelyMissingColumnError(rugResult.error.message ?? "")) break;
    rugResult = await runRugQuery(selectColumns);
  }

  if (rugResult.error || !rugResult.data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const rug = rugResult.data as unknown as Record<string, unknown>;
  if (rug.status !== "available") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const widthTotalIn =
    typeof rug.width_total_in === "number" ? rug.width_total_in : null;
  const lengthTotalIn =
    typeof rug.length_total_in === "number" ? rug.length_total_in : null;
  if (widthTotalIn === null || lengthTotalIn === null) {
    return internalError("Rug dimensions are unavailable.");
  }
  const sizeDisplay = formatRugSize(widthTotalIn, lengthTotalIn);

  const contextualBlurb = await generateContextualBlurb({
    intakeLabel:
      typeof rug.intake_label === "string" ? rug.intake_label : null,
    sizeDisplay,
    aiDescription:
      typeof rug.ai_description === "string" ? rug.ai_description : null,
  });

  const imageMap = await fetchPrimaryRugImagesForRugs({
    supabase: supabaseAdmin,
    tenantId,
    rugIds: [id],
  });
  const primaryImageUrl = imageMap.get(id)?.primary_image_url ?? null;

  const aiFields = toAiStructuredFields(rug.ai_structured_fields);
  const staffOverrides = toStaffOverrides(rug.staff_overrides ?? null);

  return NextResponse.json({
    id,
    intake_label:
      typeof rug.intake_label === "string" ? rug.intake_label : null,
    effective_fields: resolveEffectiveFields(
      typeof rug.intake_label === "string" ? rug.intake_label : null,
      aiFields,
      staffOverrides
    ),
    ai_description:
      typeof rug.ai_description === "string" ? rug.ai_description : null,
    contextual_blurb: contextualBlurb,
    width_total_in: widthTotalIn,
    length_total_in: lengthTotalIn,
    size_display: sizeDisplay,
    primary_image_url: primaryImageUrl,
  });
}

function isLikelyMissingColumnError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("does not exist") ||
    normalized.includes("schema cache") ||
    normalized.includes("could not find the")
  );
}
