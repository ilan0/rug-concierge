const CANONICAL_STYLE_NAMES = [
  "Heriz",
  "Serapi",
  "Gabbeh",
  "Kilim",
  "Oushak",
  "Bokhara",
  "Kazak",
  "Tabriz",
  "Kashan",
  "Bidjar",
  "Shiraz",
  "Nain",
] as const;

function toPlainText(value: string): string {
  return value
    .replace(/\*\*/g, "")
    .replace(/[_`#]/g, "")
    .replace(/^\s*[-*•]+\s*/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

function toTitleCase(value: string): string {
  return value
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function findCanonicalStyleName(value: string): string | null {
  const normalized = value.toLowerCase();
  for (const styleName of CANONICAL_STYLE_NAMES) {
    if (normalized.includes(styleName.toLowerCase())) {
      return styleName;
    }
  }
  return null;
}

function derivePatternDrivenStyle(input: {
  pattern: string[] | null | undefined;
  mood: string | null | undefined;
}): string | null {
  const patterns = (input.pattern ?? []).map((item) => item.toLowerCase());
  const mood = input.mood?.toLowerCase() ?? null;

  if (patterns.includes("tribal design")) return "Tribal";
  if (patterns.includes("geometric design")) {
    return mood === "traditional" ? "Geometric Tribal" : "Geometric";
  }
  if (patterns.includes("medallion center")) return "Medallion";
  if (patterns.includes("floral motif") || patterns.includes("floral border")) {
    return "Floral";
  }
  if (patterns.includes("all-over pattern")) return "All-Over";
  if (patterns.includes("plain field")) {
    if (mood === "modern" || mood === "transitional") return "Minimal";
    return "Traditional";
  }

  return null;
}

function deriveMoodDrivenStyle(mood: string | null | undefined): string | null {
  const normalized = mood?.toLowerCase();
  if (normalized === "traditional") return "Traditional";
  if (normalized === "transitional") return "Transitional";
  if (normalized === "eclectic") return "Eclectic";
  if (normalized === "modern") return "Modern";
  return null;
}

export function resolveStyleValue(input: {
  styleRaw: string | null | undefined;
  pattern: string[] | null | undefined;
  mood: string | null | undefined;
  aiDescription: string | null | undefined;
}): string | null {
  const explicitStyle = input.styleRaw ? toPlainText(input.styleRaw) : "";
  if (explicitStyle) {
    const canonical = findCanonicalStyleName(explicitStyle);
    const normalized = canonical ?? toTitleCase(explicitStyle);
    return normalized.slice(0, 80) || null;
  }

  const patternStyle = derivePatternDrivenStyle({
    pattern: input.pattern,
    mood: input.mood,
  });
  if (patternStyle) return patternStyle;

  const moodStyle = deriveMoodDrivenStyle(input.mood);
  if (moodStyle) return moodStyle;

  return null;
}
