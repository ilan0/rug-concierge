import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { badRequest, internalError } from "@/lib/errors/http-errors";
import { resolveAuthoritativeTenantForServer } from "@/lib/auth/tenant";
import { fetchPrimaryRugImagesForRugs } from "@/lib/storage/rug-images";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

function toPlainText(value: string): string {
  return value
    .replace(/\*\*/g, "")
    .replace(/[_`#]/g, "")
    .replace(/^\s*[-*•]+\s*/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

function formatSize(totalIn: number): string {
  const feet = Math.floor(totalIn / 12);
  const inches = totalIn % 12;
  if (inches === 0) return `${feet}'`;
  return `${feet}'${inches}"`;
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

function toRecordOrNull(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
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

  const rugResult = await supabaseAdmin
    .from("rugs")
    .select(
      "id, intake_label, ai_structured_fields, stock_id, ai_description, width_total_in, length_total_in, status, contextual_blurb"
    )
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();

  if (rugResult.error || !rugResult.data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const rug = rugResult.data;
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
  const sizeDisplay = `${formatSize(widthTotalIn)} × ${formatSize(lengthTotalIn)}`;

  let contextualBlurb =
    typeof rug.contextual_blurb === "string" && rug.contextual_blurb.trim().length > 0
      ? rug.contextual_blurb
      : null;

  if (!contextualBlurb) {
    contextualBlurb = await generateContextualBlurb({
      intakeLabel: rug.intake_label,
      sizeDisplay,
      aiDescription: rug.ai_description,
    });

    await supabaseAdmin
      .from("rugs")
      .update({ contextual_blurb: contextualBlurb })
      .eq("tenant_id", tenantId)
      .eq("id", id);
  }

  const imageMap = await fetchPrimaryRugImagesForRugs({
    supabase: supabaseAdmin,
    tenantId,
    rugIds: [id],
  });
  const primaryImageUrl = imageMap.get(id)?.primary_image_url ?? null;

  return NextResponse.json({
    id,
    intake_label:
      typeof rug.intake_label === "string" ? rug.intake_label : null,
    ai_structured_fields: toRecordOrNull(rug.ai_structured_fields),
    stock_id: typeof rug.stock_id === "string" ? rug.stock_id : null,
    ai_description: rug.ai_description,
    contextual_blurb: contextualBlurb,
    status: typeof rug.status === "string" ? rug.status : null,
    width_total_in: widthTotalIn,
    length_total_in: lengthTotalIn,
    size_display: sizeDisplay,
    primary_image_url: primaryImageUrl,
  });
}
