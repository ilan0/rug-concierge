import {
  visionEnrichmentSchema,
  type ParsedAiStructuredFields,
} from "@/lib/inventory/schemas";
import { postOpenAiResponses } from "@/lib/ai/response-quality";
import { formatRugSize } from "@/lib/utils/format";
import { resolveStyleValue } from "@/lib/inventory/style-normalization";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

const VISION_OUTPUT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["intake_label", "ai_description", "ai_structured_fields"],
  properties: {
    intake_label: { type: "string", minLength: 1, maxLength: 120 },
    ai_description: { type: "string", minLength: 1, maxLength: 1200 },
    ai_structured_fields: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          additionalProperties: false,
          required: [
            "origin",
            "style",
            "pattern",
            "primary_colors",
            "age_category",
            "mood",
          ],
          properties: {
            origin: {
              anyOf: [
                { type: "null" },
                {
                  type: "string",
                  enum: [
                    "Persian",
                    "Afghan",
                    "Turkish",
                    "Indian",
                    "Caucasian",
                    "Pakistani",
                    "Other",
                  ],
                },
              ],
            },
            style: { type: ["string", "null"], maxLength: 80 },
            pattern: {
              type: "array",
              items: { type: "string", maxLength: 48 },
              maxItems: 8,
            },
            primary_colors: {
              type: "array",
              items: { type: "string", maxLength: 32 },
              maxItems: 8,
            },
            age_category: {
              anyOf: [
                { type: "null" },
                {
                  type: "string",
                  enum: ["antique", "semi-antique", "vintage", "new"],
                },
              ],
            },
            mood: {
              anyOf: [
                { type: "null" },
                {
                  type: "string",
                  enum: ["traditional", "transitional", "eclectic", "modern"],
                },
              ],
            },
          },
        },
      ],
    },
  },
} as const;

export type VisionEnrichmentResult = {
  intakeLabel: string;
  aiDescription: string;
  aiStructuredFields: ParsedAiStructuredFields | null;
};

function toPlainText(value: string): string {
  return value
    .replace(/\*\*/g, "")
    .replace(/[_`#]/g, "")
    .replace(/^\s*[-*•]+\s*/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeStructuredFields(input: {
  value: ParsedAiStructuredFields | null | undefined;
  aiDescription: string;
}
): ParsedAiStructuredFields | null {
  const { value, aiDescription } = input;
  if (!value) return null;
  const normalized: ParsedAiStructuredFields = {};

  if (value.origin) normalized.origin = value.origin;
  const style = resolveStyleValue({
    styleRaw: value.style ?? null,
    pattern: value.pattern ?? [],
    mood: value.mood ?? null,
    aiDescription,
  });
  if (style) normalized.style = style.slice(0, 80);
  if (Array.isArray(value.pattern) && value.pattern.length > 0) {
    const pattern = value.pattern
      .map((item) => toPlainText(item).slice(0, 48))
      .filter((item) => item.length > 0);
    if (pattern.length > 0) normalized.pattern = pattern.slice(0, 8);
  }
  if (Array.isArray(value.primary_colors) && value.primary_colors.length > 0) {
    const colors = value.primary_colors
      .map((item) => toPlainText(item).slice(0, 32).toLowerCase())
      .filter((item) => item.length > 0);
    if (colors.length > 0) normalized.primary_colors = colors.slice(0, 8);
  }
  if (value.age_category) normalized.age_category = value.age_category;
  if (value.mood) normalized.mood = value.mood;

  return Object.keys(normalized).length > 0 ? normalized : null;
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

function parseVisionPayload(payload: unknown): VisionEnrichmentResult | null {
  const normalize = (parsed: Record<string, unknown>): VisionEnrichmentResult | null => {
    const validated = visionEnrichmentSchema.safeParse(parsed);
    if (!validated.success) return null;

    const intakeLabel = toPlainText(validated.data.intake_label).slice(0, 120);
    const aiDescription = toPlainText(validated.data.ai_description).slice(0, 1200);
    if (!intakeLabel || !aiDescription) return null;

    return {
      intakeLabel,
      aiDescription,
      aiStructuredFields: normalizeStructuredFields({
        value: validated.data.ai_structured_fields,
        aiDescription,
      }),
    };
  };

  const outputText = extractOutputText(payload);
  if (outputText) {
    const cleaned = outputText
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();
    try {
      const parsed = JSON.parse(cleaned) as Record<string, unknown>;
      const normalized = normalize(parsed);
      if (normalized) return normalized;
    } catch {
      // Fallback to JSON blocks below.
    }
  }

  if (!payload || typeof payload !== "object") return null;
  const data = payload as Record<string, unknown>;
  if (!Array.isArray(data.output)) return null;

  for (const item of data.output) {
    if (!item || typeof item !== "object") continue;
    const outputItem = item as Record<string, unknown>;
    if (!Array.isArray(outputItem.content)) continue;

    for (const part of outputItem.content) {
      if (!part || typeof part !== "object") continue;
      const block = part as Record<string, unknown>;
      if (!block.json || typeof block.json !== "object") continue;
      const normalized = normalize(block.json as Record<string, unknown>);
      if (normalized) return normalized;
    }
  }

  return null;
}

export async function requestVisionEnrichment(input: {
  imageUrl: string;
  widthTotalIn: number | null;
  lengthTotalIn: number | null;
}): Promise<VisionEnrichmentResult | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const sizeDisplay =
    typeof input.widthTotalIn === "number" && typeof input.lengthTotalIn === "number"
      ? formatRugSize(input.widthTotalIn, input.lengthTotalIn)
      : null;

  const requestPayload = {
    model: "gpt-4o",
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text:
              "You are an expert rug appraiser. Analyze the rug in this photo and return valid JSON only. Use measured size as context for scale only. Never include dimensions in the intake_label. Leave uncertain fields as null and unknown list fields as empty arrays.\n\nStyle is important: provide a concise style value whenever possible (named style preferred, otherwise broad style like Traditional, Tribal, Geometric, Floral, Modern, Transitional). Use null only when truly impossible.\n\nReturn shape:\n{\n  \"intake_label\": \"3-6 words, descriptive, no dimensions\",\n  \"ai_description\": \"1-2 sentences: style tradition, palette, motifs, room fit\",\n  \"ai_structured_fields\": {\n    \"origin\": \"Persian|Afghan|Turkish|Indian|Caucasian|Pakistani|Other|null\",\n    \"style\": \"named style like Heriz/Serapi/Gabbeh/Kilim or concise broad style, or null only when impossible\",\n    \"pattern\": [\"medallion center\", \"all-over pattern\", \"geometric design\", \"floral motif\", \"tribal design\", \"floral border\", \"pictorial\", \"plain field\"],\n    \"primary_colors\": [\"red\",\"navy\",\"ivory\",\"gold\",\"rust\",\"teal\",\"brown\",\"green\",\"blue\",\"black\",\"cream\",\"coral\"],\n    \"age_category\": \"antique|semi-antique|vintage|new|null\",\n    \"mood\": \"traditional|transitional|eclectic|modern|null\"\n  }\n}",
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: sizeDisplay
              ? `Measured size: ${sizeDisplay}. Analyze this rug photo.`
              : "Analyze this rug photo.",
          },
          {
            type: "input_image",
            image_url: input.imageUrl,
          },
        ],
      },
    ],
    max_output_tokens: 700,
    text: {
      format: {
        type: "json_schema",
        name: "rug_vision_enrichment",
        schema: VISION_OUTPUT_JSON_SCHEMA,
        strict: true,
      },
    },
  };

  const response = await postOpenAiResponses({
    url: OPENAI_RESPONSES_URL,
    apiKey,
    requestPayload,
    surface: "vision_enrichment",
  });
  if (!response.ok) {
    return null;
  }

  return parseVisionPayload(response.response_payload);
}
