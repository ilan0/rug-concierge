import {
  visionEnrichmentSchema,
  type ParsedAiStructuredFields,
} from "@/lib/inventory/schemas";
import { CANONICAL_COLORS, normalizeColorList } from "@/lib/config/color-taxonomy";
import {
  confidenceForValue,
  normalizeConfidence,
} from "@/lib/inventory/confidence";

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

const COLOR_PROMPT_LIST = CANONICAL_COLORS.map((color) => `"${color}"`).join(", ");

export const VISION_OUTPUT_JSON_SCHEMA = {
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
            "origin_confidence",
            "style",
            "style_confidence",
            "pattern",
            "primary_colors",
            "age_category",
            "mood",
            "is_rug",
            "is_rug_confidence",
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
            origin_confidence: {
              anyOf: [
                { type: "null" },
                { type: "string", enum: ["low", "medium", "high"] },
              ],
            },
            style: { type: ["string", "null"], maxLength: 80 },
            style_confidence: {
              anyOf: [
                { type: "null" },
                { type: "string", enum: ["low", "medium", "high"] },
              ],
            },
            pattern: {
              type: "array",
              items: { type: "string", maxLength: 48 },
              maxItems: 8,
            },
            primary_colors: {
              type: "array",
              items: {
                type: "string",
                enum: CANONICAL_COLORS,
              },
              maxItems: 4,
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
              type: "string",
              enum: ["traditional", "transitional", "eclectic", "modern"],
            },
            is_rug: { type: "boolean" },
            is_rug_confidence: {
              type: "string",
              enum: ["low", "medium", "high"],
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

export function buildVisionSystemPrompt(): string {
  return `You are an expert luxury rug appraiser. Analyze the rug photo and return valid JSON only. Use measured size as scale context only. Never include dimensions in intake_label. Leave uncertain scalar fields as null and unknown list fields as empty arrays.

Primary objective: extract commercially useful trade vocabulary into ai_structured_fields while avoiding false factual claims about provenance.

Confidence rules (strict):
- Do not guess.
- If origin or style is uncertain, either set the field to null or set confidence to low.
- origin_confidence and style_confidence must each be one of: low, medium, high, or null when the field itself is null.
- High confidence means the image contains strong visual evidence for that attribution.
- Medium confidence means the attribution is plausible and useful commercially, but not certain.
- Low confidence means the rug only loosely resembles that style/origin and the field should not be treated as a hard factual claim.

Origin rules (strict):
- Do not infer country or region of manufacture from design family alone.
- Oushak, Heriz, Kashan, Bokhara, Gabbeh, and similar names may describe design family or trade style rather than confirmed origin.
- Pakistani or Indian copies/reproductions of Persian or Turkish families are common.
- If the rug looks like an Oushak-style rug but the manufacture origin is not visually confirmable, you may keep style=Oushak with medium or low confidence, but origin must be null or low-confidence only if there is actual evidence.

Non-rug rules (strict):
- If the image is a storefront, signage, non-rug scene, artwork, manuscript, painting, book cover, furniture, or too partial/blurry to classify confidently, set is_rug=false.
- Always set is_rug_confidence as one of: low, medium, high.
- Set origin/style/age_category to null when is_rug=false.

Age rules (strict):
- Do not default age_category to traditional.
- Use age_category=traditional only when the rug is clearly hand-knotted in a traditional design and the era is not clearly antique, semi-antique, or vintage.

Style rules (strict):
- style is for named weave/style families only. Use values like Heriz, Serapi, Kashan, Isfahan, Tabriz, Kerman, Nain, Qom, Bidjar, Malayer, Sarouk, Sultanabad, Bakhtiari, Hamadan, Mashad, Qashqai, Gabbeh, Kilim, Soumak, Baluch, Turkmen, Bokhara, Oushak, Kazak, Shirvan, Karabagh, Beni Ourain, Azilal, and similar named types.
- If a specific named style family cannot be identified, return style as null.
- Never use pattern descriptors such as Geometric, Floral, Tribal, or Traditional as the style value.

Color rules (strict):
- primary_colors must use this canonical list only: [${COLOR_PROMPT_LIST}].
- Return 1-4 colors only.
- Order by dominance: field color first, primary border second, accent details third by visual prominence.
- If the image suggests a non-listed color term, map it to the closest canonical color.
- Do not return abstract adjectives like "dark" or "light" as colors.

Mood rules (strict):
- mood is always required.
- Always return exactly one mood value.
- Never return mood as null.

Shape guidance (strict):
- If the rug is not a standard rectangular area rug, explicitly state the shape in ai_description.
- Valid non-rectangular shapes are square, round, oval, and runner.
- Never infer shape from dimensions alone.

intake_label is fallback-only and must still use trade vocabulary. Prefer safe merchandising language over overconfident provenance claims.
- If origin is uncertain, omit it from the label.
- If style resembles a named family but provenance is uncertain, use style-family wording only.
- Do not produce color-led or pattern-led labels when a stronger trade label is available.

Correct style example: "Heriz". Incorrect style example: "Geometric".
Correct exact title example: "Antique Persian Heriz".
Correct softened title example: "Traditional Oushak-Style Rug".
Incorrect title example: "Red geometric tribal rug".
Do not invent quality claims such as Fine, Very Fine, Rare, or Collectible.

Return shape:
{
  "intake_label": "3-6 words, fallback trade title, no dimensions, no color-led phrasing",
  "ai_description": "1-2 sentences: concise visual and merchandising summary",
  "ai_structured_fields": {
    "origin": "Persian|Afghan|Turkish|Indian|Caucasian|Pakistani|Moroccan|Central Asian|Other|null",
    "origin_confidence": "low|medium|high|null",
    "style": "named weave/style family only (for example Heriz, Oushak, Gabbeh, Bokhara) or null",
    "style_confidence": "low|medium|high|null",
    "pattern": ["medallion center", "all-over pattern", "geometric design", "floral motif", "tribal design", "floral border", "pictorial", "plain field"],
    "primary_colors": [${COLOR_PROMPT_LIST}],
    "age_category": "antique|semi-antique|vintage|traditional|contemporary|new|null",
    "mood": "traditional|transitional|eclectic|modern",
    "is_rug": "boolean",
    "is_rug_confidence": "low|medium|high"
  }
}`;
}

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
  const isRug = typeof value.is_rug === "boolean" ? value.is_rug : null;

  if (isRug !== null) {
    normalized.is_rug = isRug;
  }
  const rugConfidence = normalizeConfidence(value.is_rug_confidence);
  if (rugConfidence) {
    normalized.is_rug_confidence = rugConfidence;
  }

  if (isRug === false) {
    if (value.mood) normalized.mood = value.mood;
    if (Array.isArray(value.primary_colors) && value.primary_colors.length > 0) {
      const colors = normalizeColorList(
        value.primary_colors.map((item) => toPlainText(item).slice(0, 32).toLowerCase()),
        4
      );
      if (colors.length > 0) normalized.primary_colors = colors.slice(0, 4);
    }
    return normalized;
  }

  const style = toTradeStyleValue(value.style ?? null);
  if (style) {
    normalized.style = style;
  }
  const styleConfidence = confidenceForValue(
    Boolean(style),
    normalizeConfidence(value.style_confidence)
  );
  if (styleConfidence) {
    normalized.style_confidence = styleConfidence;
  }

  const origin = value.origin ?? null;
  if (origin) {
    normalized.origin = origin;
  }
  const originConfidence = confidenceForValue(
    Boolean(origin),
    normalizeConfidence(value.origin_confidence)
  );
  if (originConfidence) {
    normalized.origin_confidence = originConfidence;
  }

  if (Array.isArray(value.pattern) && value.pattern.length > 0) {
    const pattern = value.pattern
      .map((item) => toPlainText(item).slice(0, 48))
      .filter((item) => item.length > 0);
    if (pattern.length > 0) normalized.pattern = pattern.slice(0, 8);
  }
  if (Array.isArray(value.primary_colors) && value.primary_colors.length > 0) {
    const colors = normalizeColorList(
      value.primary_colors.map((item) => toPlainText(item).slice(0, 32).toLowerCase()),
      4
    );
    if (colors.length > 0) normalized.primary_colors = colors.slice(0, 4);
  }
  if (value.age_category) {
    const ageCategory = value.age_category;
    const hasEnoughSignalForTraditional =
      ageCategory !== "traditional" ||
      Boolean(normalized.origin || normalized.style || normalized.pattern?.length);
    if (hasEnoughSignalForTraditional) {
      normalized.age_category = ageCategory;
    }
  }
  if (value.mood) normalized.mood = value.mood;

  if (
    /\bnot\s+(a\s+)?rug\b/i.test(`${aiDescription} ${intakeLabel}`) &&
    normalized.is_rug !== true
  ) {
    normalized.is_rug = false;
    normalized.is_rug_confidence = normalized.is_rug_confidence ?? "high";
  }

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

export function parseVisionPayload(payload: unknown): VisionEnrichmentResult | null {
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
      // Fall through to JSON part parsing.
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
