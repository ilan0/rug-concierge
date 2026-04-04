export type TradeTitleAiFields = {
  origin?: string | null;
  style?: string | null;
  pattern?: string[] | null;
  primary_colors?: string[] | null;
  age_category?: string | null;
  mood?: string | null;
};

export type BuildTradeTitleInput = {
  aiFields: TradeTitleAiFields | null | undefined;
  widthTotalIn: number | null | undefined;
  lengthTotalIn: number | null | undefined;
  fallbackLabel: string | null | undefined;
};

const ERA_TOKEN_BY_AGE: Readonly<Record<string, string>> = {
  antique: "Antique",
  "semi-antique": "Semi-Antique",
  vintage: "Vintage",
  traditional: "Traditional",
  contemporary: "Contemporary",
  new: "Decorative",
};

const EXCLUDED_ORIGIN_TOKENS = new Set(["other", "central asian"]);

const PATTERN_STYLE_WORDS = new Set([
  "geometric",
  "floral",
  "traditional",
  "tribal",
  "modern",
  "transitional",
  "medallion",
  "all over",
  "all-over",
]);

const CONTEMPORARY_STYLE_DESCRIPTORS: ReadonlyArray<{
  canonical: string;
  aliases: readonly string[];
}> = [
  { canonical: "Minimal", aliases: ["minimal", "minimalist", "simple", "clean"] },
  { canonical: "Plain", aliases: ["plain"] },
  { canonical: "Abstract", aliases: ["abstract"] },
  { canonical: "Geometric", aliases: ["geometric"] },
  { canonical: "Transitional", aliases: ["transitional"] },
  { canonical: "Decorative", aliases: ["decorative"] },
  { canonical: "Contemporary", aliases: ["contemporary"] },
  { canonical: "Modern", aliases: ["modern"] },
  { canonical: "Textural", aliases: ["textural", "textured"] },
  { canonical: "Tonal", aliases: ["tonal"] },
  { canonical: "Neutral", aliases: ["neutral"] },
  { canonical: "Organic", aliases: ["organic"] },
  { canonical: "Linear", aliases: ["linear"] },
];

const TRADE_STYLE_ALIASES: ReadonlyArray<{ canonical: string; aliases: readonly string[] }> = [
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

function titleHasDimensionLeak(title: string): boolean {
  return /(\b\d+\s?[x×]\s?\d+\b|\d+\s?(ft|feet|in|inch|inches)\b|\b\d+'\s*\d*\"?)/i.test(
    title
  );
}

function titleHasBannedLuxuryClaim(title: string): boolean {
  return /\b(very\s+fine|fine|rare|collectible)\b/i.test(title);
}

function titleHasCommodityLead(title: string): boolean {
  const normalized = title.trim().toLowerCase();
  if (!normalized) return true;
  const commodityLead = [
    /^(red|blue|green|ivory|black|brown|gold|rust|cream|beige|gray|grey|navy)\b/,
    /^(floral|geometric|medallion|tribal|traditional)\b/,
  ];
  return commodityLead.some((regex) => regex.test(normalized));
}

function titleHasDuplicateTokens(title: string): boolean {
  const tokens = title
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.replace(/[^a-z0-9-]/g, ""))
    .filter(Boolean);
  const seen = new Set<string>();
  for (const token of tokens) {
    if (seen.has(token)) return true;
    seen.add(token);
  }
  return false;
}

function isMalformedShortLabel(title: string): boolean {
  const trimmed = title.trim();
  if (!trimmed) return true;
  if (trimmed.length < 4) return true;
  const words = trimmed.split(/\s+/).filter(Boolean);
  return words.length <= 1;
}

function normalizeText(value: string | null | undefined): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/\*\*/g, "")
    .replace(/[_`#]/g, "")
    .replace(/^\s*[-*•]+\s*/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeLookupText(value: string | null | undefined): string {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleCaseWord(word: string): string {
  const lower = word.toLowerCase();
  if (!lower) return lower;
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function titleCaseToken(token: string): string {
  if (token === "Semi-Antique") return token;
  return token
    .split(" ")
    .filter(Boolean)
    .map((word) =>
      word
        .split("-")
        .filter(Boolean)
        .map((part) => titleCaseWord(part))
        .join("-")
    )
    .join(" ");
}

function wordBoundaryIndex(haystack: string, needle: string): number {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`\\b${escaped}\\b`, "i");
  const match = haystack.match(regex);
  return typeof match?.index === "number" ? match.index : -1;
}

function uniqueTokens(tokens: Array<string | null>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  for (const token of tokens) {
    const normalized = normalizeText(token);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }

  return out;
}

function getEraToken(ageCategory: string | null | undefined): string | null {
  const normalized = normalizeLookupText(ageCategory);
  if (!normalized) return null;
  return ERA_TOKEN_BY_AGE[normalized] ?? null;
}

function getOriginToken(origin: string | null | undefined): string | null {
  const normalized = normalizeText(origin);
  if (!normalized) return null;

  if (EXCLUDED_ORIGIN_TOKENS.has(normalized.toLowerCase())) {
    return null;
  }

  return titleCaseToken(normalized);
}

function getStyleToken(styleRaw: string | null | undefined): string | null {
  const plain = normalizeText(styleRaw);
  if (!plain) return null;

  const normalized = normalizeLookupText(plain);
  if (!normalized) return null;

  if (PATTERN_STYLE_WORDS.has(normalized)) {
    return null;
  }

  const matches: Array<{ canonical: string; index: number }> = [];
  for (const entry of TRADE_STYLE_ALIASES) {
    let firstIndex = Number.POSITIVE_INFINITY;

    for (const alias of entry.aliases) {
      const index = wordBoundaryIndex(normalized, alias.toLowerCase());
      if (index >= 0) {
        firstIndex = Math.min(firstIndex, index);
      }
    }

    if (Number.isFinite(firstIndex)) {
      matches.push({ canonical: entry.canonical, index: firstIndex });
    }
  }

  if (matches.length === 0) {
    return null;
  }

  matches.sort((left, right) => left.index - right.index);

  const uniqueStyles: string[] = [];
  const seen = new Set<string>();
  for (const match of matches) {
    const key = match.canonical.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueStyles.push(match.canonical);
    if (uniqueStyles.length >= 2) break;
  }

  return uniqueStyles.join(" ") || null;
}

function isContemporaryEraToken(token: string | null): boolean {
  return token === "Contemporary" || token === "Decorative";
}

function getContemporaryDescriptiveStyleToken(styleRaw: string | null | undefined): string | null {
  const plain = normalizeText(styleRaw);
  if (!plain) return null;

  const normalized = normalizeLookupText(plain);
  if (!normalized) return null;

  const matches: Array<{ canonical: string; index: number }> = [];
  for (const descriptor of CONTEMPORARY_STYLE_DESCRIPTORS) {
    let firstIndex = Number.POSITIVE_INFINITY;
    for (const alias of descriptor.aliases) {
      const index = wordBoundaryIndex(normalized, alias.toLowerCase());
      if (index >= 0) {
        firstIndex = Math.min(firstIndex, index);
      }
    }
    if (Number.isFinite(firstIndex)) {
      matches.push({ canonical: descriptor.canonical, index: firstIndex });
    }
  }

  if (matches.length === 0) return null;
  matches.sort((left, right) => left.index - right.index);
  return matches[0]?.canonical ?? null;
}

function hasRoundKeyword(value: string | null | undefined): boolean {
  const text = normalizeLookupText(value);
  if (!text) return false;
  return /\b(round|circular|circle|oval)\b/i.test(text);
}

function isRunnerByDimensions(width: number, length: number): boolean {
  const shortSide = Math.min(width, length);
  const longSide = Math.max(width, length);
  if (shortSide <= 0 || longSide <= 0) return false;
  return shortSide <= 48 && longSide >= 84 && longSide / shortSide >= 2.2;
}

function getFormatToken(input: {
  fallbackLabel: string | null | undefined;
  widthTotalIn: number | null | undefined;
  lengthTotalIn: number | null | undefined;
}): string | null {
  if (hasRoundKeyword(input.fallbackLabel)) {
    return "Round";
  }

  if (
    typeof input.widthTotalIn === "number" &&
    typeof input.lengthTotalIn === "number" &&
    isRunnerByDimensions(input.widthTotalIn, input.lengthTotalIn)
  ) {
    return "Runner";
  }

  return null;
}

export function sanitizeFallbackTradeLabel(label: string | null | undefined): string | null {
  const normalized = normalizeText(label);
  if (!normalized) return null;
  if (titleHasDimensionLeak(normalized)) return null;
  if (titleHasBannedLuxuryClaim(normalized)) return null;
  if (titleHasCommodityLead(normalized)) return null;
  if (titleHasDuplicateTokens(normalized)) return null;
  if (isMalformedShortLabel(normalized)) return null;
  return titleCaseToken(normalized);
}

export function buildTradeTitle(input: BuildTradeTitleInput): string | null {
  const aiFields = input.aiFields ?? {};

  const eraToken = getEraToken(aiFields.age_category ?? null);
  const originToken = getOriginToken(aiFields.origin ?? null);
  const tradeStyleToken = getStyleToken(aiFields.style ?? null);
  const styleToken =
    tradeStyleToken ??
    (isContemporaryEraToken(eraToken)
      ? getContemporaryDescriptiveStyleToken(aiFields.style ?? null)
      : null);
  const formatToken = getFormatToken({
    fallbackLabel: input.fallbackLabel,
    widthTotalIn: input.widthTotalIn,
    lengthTotalIn: input.lengthTotalIn,
  });

  const dedupedStyle =
    styleToken && originToken && styleToken.toLowerCase() === originToken.toLowerCase()
      ? null
      : styleToken;

  const leadingTokens =
    eraToken === "Traditional"
      ? [originToken, dedupedStyle, eraToken]
      : [eraToken, originToken, dedupedStyle];

  const tokens = uniqueTokens([...leadingTokens, formatToken]);
  if (tokens.length <= 1) return null;

  return tokens.map((token) => titleCaseToken(token)).join(" ");
}
