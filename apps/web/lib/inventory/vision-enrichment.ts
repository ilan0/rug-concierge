import {
  visionEnrichmentSchema,
  type ParsedAiStructuredFields,
} from "@/lib/inventory/schemas";
import { postOpenAiResponses } from "@/lib/ai/response-quality";
import {
  OPENAI_API_KEY,
  OPENAI_VISION_MODEL,
} from "@/lib/config";
import { formatRugSize } from "@/lib/utils/format";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

const TRADE_STYLE_ALIASES: ReadonlyArray<{
  canonical: string;
  aliases: readonly string[];
}> = [
  { canonical: "Heriz", aliases: ["heriz"] },
  { canonical: "Serapi", aliases: ["serapi", "serab"] },
  { canonical: "Kashan", aliases: ["kashan"] },
  { canonical: "Isfahan", aliases: ["isfahan", "esfahan"] },
  { canonical: "Tabriz", aliases: ["tabriz"] },
  { canonical: "Kerman", aliases: ["kerman", "kirman"] },
  { canonical: "Nain", aliases: ["nain", "naein"] },
  { canonical: "Qom", aliases: ["qom", "qum"] },
  { canonical: "Bidjar", aliases: ["bidjar", "bijar"] },
  { canonical: "Malayer", aliases: ["malayer"] },
  { canonical: "Sarouk", aliases: ["sarouk", "saruk"] },
  { canonical: "Sultanabad", aliases: ["sultanabad", "arak"] },
  { canonical: "Bakhtiari", aliases: ["bakhtiari", "bakhtiar"] },
  { canonical: "Hamadan", aliases: ["hamadan", "hamedan"] },
  { canonical: "Mashad", aliases: ["mashad", "mashhad"] },
  { canonical: "Qashqai", aliases: ["qashqai", "ghashghai"] },
  { canonical: "Gabbeh", aliases: ["gabbeh", "gabba"] },
  { canonical: "Kilim", aliases: ["kilim"] },
  { canonical: "Soumak", aliases: ["soumak", "sumak"] },
  { canonical: "Baluch", aliases: ["baluch", "baluchi", "beluch"] },
  { canonical: "Turkmen", aliases: ["turkmen", "turkoman"] },
  { canonical: "Bokhara", aliases: ["bokhara", "bukhara"] },
  { canonical: "Oushak", aliases: ["oushak", "ushak"] },
  { canonical: "Kazak", aliases: ["kazak", "qazak"] },
  { canonical: "Shirvan", aliases: ["shirvan", "shirwan"] },
  { canonical: "Karabagh", aliases: ["karabagh", "karabakh"] },
  { canonical: "Beni Ourain", aliases: ["beni ourain", "beniourain"] },
  { canonical: "Azilal", aliases: ["azilal"] },
];

const PATTERN_STYLE_WORDS = new Set([
  "traditional",
  "tribal",
  "geometric",
  "floral",
  "modern",
  "transitional",
  "medallion",
]);

function inferOriginFromStyle(
  style: string | null
): ParsedAiStructuredFields["origin"] | null {
  if (!style) return null;
  const normalized = style.toLowerCase().replace(/\s+/g, " ").trim();
  const words = new Set(normalized.split(" ").filter(Boolean));

  const persianStyles = new Set([
    "heriz",
    "serapi",
    "kashan",
    "isfahan",
    "tabriz",
    "kerman",
    "nain",
    "qom",
    "bidjar",
    "malayer",
    "sarouk",
    "sultanabad",
    "bakhtiari",
    "hamadan",
    "mashad",
    "qashqai",
  ]);
  for (const token of words) {
    if (persianStyles.has(token)) return "Persian";
  }

  if (words.has("gabbeh")) return "Afghan";
  if (words.has("oushak")) return "Turkish";
  if (words.has("kazak") || words.has("shirvan") || words.has("karabagh")) {
    return "Caucasian";
  }
  if (words.has("bokhara") || words.has("turkmen") || words.has("baluch")) {
    return "Central Asian";
  }
  if (normalized.includes("beni ourain") || words.has("azilal")) return "Moroccan";
  return null;
}

function inferOriginFromContext(
  text: string
): ParsedAiStructuredFields["origin"] | null {
  const normalized = text.toLowerCase();
  if (!normalized) return null;
  if (/\bpersian\b/.test(normalized)) return "Persian";
  if (/\bafghan\b/.test(normalized)) return "Afghan";
  if (/\bturkish\b|\boushak\b|\bushak\b/.test(normalized)) return "Turkish";
  if (/\bcaucasian\b/.test(normalized)) return "Caucasian";
  if (/\bpakistani\b/.test(normalized)) return "Pakistani";
  if (/\bindian\b/.test(normalized)) return "Indian";
  if (/\bmoroccan\b/.test(normalized)) return "Moroccan";
  if (/\bcentral asian\b|\bturkmen\b|\bbokhara\b|\bbukhara\b/.test(normalized)) {
    return "Central Asian";
  }
  return null;
}

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
                    "Moroccan",
                    "Central Asian",
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
                  enum: [
                    "antique",
                    "semi-antique",
                    "vintage",
                    "traditional",
                    "contemporary",
                    "new",
                  ],
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

function normalizeLookupText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wordBoundaryIndex(haystack: string, needle: string): number {
  const regex = new RegExp(`\\b${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  const match = haystack.match(regex);
  return typeof match?.index === "number" ? match.index : -1;
}

function toTradeStyleValue(styleRaw: string | null | undefined): string | null {
  if (typeof styleRaw !== "string") return null;
  const plain = toPlainText(styleRaw);
  if (!plain) return null;

  const normalized = normalizeLookupText(plain);
  if (!normalized) return null;
  if (PATTERN_STYLE_WORDS.has(normalized)) return null;

  const matches: Array<{ canonical: string; index: number }> = [];
  for (const entry of TRADE_STYLE_ALIASES) {
    let firstIndex = Number.POSITIVE_INFINITY;
    for (const alias of entry.aliases) {
      const idx = wordBoundaryIndex(normalized, alias.toLowerCase());
      if (idx >= 0) {
        firstIndex = Math.min(firstIndex, idx);
      }
    }
    if (Number.isFinite(firstIndex)) {
      matches.push({ canonical: entry.canonical, index: firstIndex });
    }
  }

  if (matches.length === 0) return null;

  const ordered = matches.sort((left, right) => left.index - right.index);
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const match of ordered) {
    const key = match.canonical.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(match.canonical);
    if (unique.length >= 2) break;
  }

  const style = unique.join(" ").trim();
  return style ? style.slice(0, 80) : null;
}

function normalizeStructuredFields(input: {
  value: ParsedAiStructuredFields | null | undefined;
  aiDescription: string;
  intakeLabel: string;
}): ParsedAiStructuredFields | null {
  const { value, aiDescription, intakeLabel } = input;
  if (!value) return null;
  const normalized: ParsedAiStructuredFields = {};

  const styleFromModel = toTradeStyleValue(value.style ?? null);
  const styleFromDescription = styleFromModel
    ? null
    : toTradeStyleValue(aiDescription ?? null);
  let style = styleFromModel ?? styleFromDescription;
  const contextText = `${aiDescription} ${intakeLabel}`.trim();
  const hasPictorialCue =
    /\bpictorial\b/.test(contextText.toLowerCase()) ||
    (Array.isArray(value.pattern) &&
      value.pattern.some((item) => /\bpictorial\b/i.test(String(item ?? ""))));
  if (hasPictorialCue && (!style || style === "Qashqai")) {
    style = "Qom";
  }
  if (style) normalized.style = style;
  const styleOrigin = inferOriginFromStyle(style);
  const incomingOrigin = value.origin ?? null;
  const contextOrigin = inferOriginFromContext(contextText);
  if (incomingOrigin && incomingOrigin !== "Other") {
    normalized.origin = incomingOrigin;
  } else if (styleOrigin) {
    normalized.origin = styleOrigin;
  } else if (contextOrigin) {
    normalized.origin = contextOrigin;
  } else if (incomingOrigin) {
    normalized.origin = incomingOrigin;
  }
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
  if (value.age_category) {
    const ageCategory = value.age_category;
    const hasEnoughSignalForTraditional =
      ageCategory !== "traditional" || Boolean(normalized.origin || normalized.style);
    if (hasEnoughSignalForTraditional) {
      normalized.age_category = ageCategory;
    }
  }
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
        intakeLabel,
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
  const sizeDisplay =
    typeof input.widthTotalIn === "number" && typeof input.lengthTotalIn === "number"
      ? formatRugSize(input.widthTotalIn, input.lengthTotalIn)
      : null;

  const requestPayload = {
    model: OPENAI_VISION_MODEL,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text:
              "You are an expert luxury rug appraiser. Analyze the rug photo and return valid JSON only. Use measured size as scale context only. Never include dimensions in intake_label. Leave uncertain scalar fields as null and unknown list fields as empty arrays.\n\nPrimary objective: extract accurate trade vocabulary into ai_structured_fields (especially origin, style/weave name, and age_category).\n\nConfidence rules (strict): do not guess. If origin/style/age_category is uncertain, return null.\n- If the image is a storefront, signage, non-rug scene, or too partial/blurry to classify confidently, return origin/style/age_category as null.\n- Do not default age_category to traditional.\n- Use age_category=traditional only when the rug is clearly hand-knotted in a traditional design and the era is not clearly antique/semi-antique/vintage.\n\nStyle rules (strict): style is for named weave/style types only. Use values like Heriz, Serapi, Kashan, Isfahan, Tabriz, Kerman, Nain, Qom, Bidjar, Malayer, Sarouk, Sultanabad, Bakhtiari, Hamadan, Mashad, Qashqai, Gabbeh, Kilim, Soumak, Baluch, Turkmen, Bokhara, Oushak, Kazak, Shirvan, Karabagh, Beni Ourain, Azilal, and similar named types. If a specific named style cannot be identified, return style as null. Never use pattern descriptors for style.\n\nintake_label is fallback-only and must still use trade vocabulary. Use era + origin + style when available. Do not produce color-led or pattern-led labels.\nCorrect style example: \"Heriz\". Incorrect style example: \"Geometric\".\nCorrect intake_label example: \"Antique Persian Heriz\". Incorrect intake_label example: \"Red geometric tribal rug\".\nDo not invent quality claims such as Fine, Very Fine, Rare, or Collectible.\n\nReturn shape:\n{\n  \"intake_label\": \"3-6 words, fallback trade title, no dimensions, no color-led phrasing\",\n  \"ai_description\": \"1-2 sentences: concise visual and merchandising summary\",\n  \"ai_structured_fields\": {\n    \"origin\": \"Persian|Afghan|Turkish|Indian|Caucasian|Pakistani|Moroccan|Central Asian|Other|null\",\n    \"style\": \"named weave/style only (for example Heriz, Oushak, Gabbeh, Bokhara) or null\",\n    \"pattern\": [\"medallion center\", \"all-over pattern\", \"geometric design\", \"floral motif\", \"tribal design\", \"floral border\", \"pictorial\", \"plain field\"],\n    \"primary_colors\": [\"red\",\"navy\",\"ivory\",\"gold\",\"rust\",\"teal\",\"brown\",\"green\",\"blue\",\"black\",\"cream\",\"coral\"],\n    \"age_category\": \"antique|semi-antique|vintage|traditional|contemporary|new|null\",\n    \"mood\": \"traditional|transitional|eclectic|modern|null\"\n  }\n}",
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
    max_output_tokens: 450,
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
    apiKey: OPENAI_API_KEY,
    requestPayload,
    surface: "vision_enrichment",
  });
  if (!response.ok) {
    return null;
  }

  return parseVisionPayload(response.response_payload);
}
