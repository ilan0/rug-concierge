export const CANONICAL_COLORS = [
  "white",
  "ivory",
  "gray",
  "black",
  "brown",
  "blue",
  "teal",
  "green",
  "red",
  "rust",
  "gold",
  "pink",
  "purple",
  "multi",
] as const;

export type CanonicalColor = (typeof CANONICAL_COLORS)[number];

export const COLOR_FAMILIES = {
  neutral: ["ivory", "white", "gray", "black", "brown"],
  blue_core: ["blue"],
  teal_bridge: ["teal"],
  green_core: ["green"],
  red_rust: ["red", "rust"],
  gold: ["gold"],
  pink: ["pink"],
  purple: ["purple"],
  multi: ["multi"],
} as const satisfies Record<string, readonly CanonicalColor[]>;

export const COLOR_FAMILY_ADJACENCY = {
  neutral: ["blue_core", "green_core", "gold", "red_rust", "pink", "purple"],
  blue_core: ["teal_bridge", "neutral", "purple"],
  teal_bridge: ["blue_core", "green_core"],
  green_core: ["teal_bridge", "neutral", "gold"],
  red_rust: ["gold", "neutral"],
  gold: ["neutral", "red_rust", "green_core"],
  pink: ["neutral"],
  purple: ["neutral", "blue_core"],
  multi: [
    "neutral",
    "blue_core",
    "teal_bridge",
    "green_core",
    "red_rust",
    "gold",
    "pink",
    "purple",
  ],
} as const satisfies Record<keyof typeof COLOR_FAMILIES, readonly (keyof typeof COLOR_FAMILIES)[]>;

export const COLOR_FAMILY_NEVER_CROSS = [
  ["red_rust", "pink"],
  ["red_rust", "purple"],
] as const;

const CANONICAL_COLOR_SET = new Set<string>(CANONICAL_COLORS);

const COLOR_ALIASES: Record<string, CanonicalColor> = {
  // neutrals
  offwhite: "ivory",
  "off white": "ivory",
  cream: "ivory",
  beige: "ivory",
  tan: "ivory",
  taupe: "ivory",
  bone: "ivory",
  linen: "ivory",
  sand: "ivory",
  camel: "ivory",
  greige: "ivory",
  stone: "ivory",
  charcoal: "gray",
  grey: "gray",
  slate: "gray",
  steel: "gray",
  silver: "gray",
  // warm spectrum
  burgundy: "red",
  maroon: "red",
  wine: "red",
  crimson: "red",
  brick: "rust",
  tomato: "red",
  cherry: "red",
  terracotta: "rust",
  orange: "rust",
  copper: "rust",
  yellow: "gold",
  ochre: "gold",
  mustard: "gold",
  saffron: "gold",
  honey: "gold",
  amber: "gold",
  coral: "pink",
  salmon: "pink",
  blush: "pink",
  rose: "pink",
  fuchsia: "pink",
  magenta: "pink",
  peach: "pink",
  // cool spectrum
  indigo: "blue",
  cobalt: "blue",
  denim: "blue",
  midnight: "blue",
  navy: "blue",
  aqua: "teal",
  turquoise: "teal",
  cyan: "teal",
  mint: "green",
  sage: "green",
  olive: "green",
  emerald: "green",
  hunter: "green",
  forest: "green",
  // purple spectrum
  violet: "purple",
  plum: "purple",
  lavender: "purple",
  lilac: "purple",
  amethyst: "purple",
  eggplant: "purple",
  // multi
  multicolor: "multi",
  "multi color": "multi",
  multicolour: "multi",
  "multi colour": "multi",
  // spanish common terms
  blanco: "white",
  marfil: "ivory",
  gris: "gray",
  negro: "black",
  marron: "brown",
  cafe: "brown",
  azul: "blue",
  turquesa: "teal",
  verde: "green",
  rojo: "red",
  oxido: "rust",
  dorado: "gold",
  rosa: "pink",
  morado: "purple",
  purpura: "purple",
};

const COLOR_PARSE_INDEX: Array<{ term: string; canonical: CanonicalColor }> = [
  ...CANONICAL_COLORS.map((canonical) => ({ term: canonical, canonical })),
  ...Object.entries(COLOR_ALIASES).map(([term, canonical]) => ({
    term,
    canonical,
  })),
].sort((left, right) => right.term.length - left.term.length);

const FAMILY_BY_COLOR = new Map<CanonicalColor, string>();
for (const [family, colors] of Object.entries(COLOR_FAMILIES)) {
  for (const color of colors) {
    if (!FAMILY_BY_COLOR.has(color)) {
      FAMILY_BY_COLOR.set(color, family);
    }
  }
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function normalizeColorToken(value: string | null | undefined): CanonicalColor | null {
  if (typeof value !== "string") return null;
  const normalized = normalizeText(value);
  if (!normalized) return null;

  if (CANONICAL_COLOR_SET.has(normalized)) {
    return normalized as CanonicalColor;
  }

  if (normalized in COLOR_ALIASES) {
    return COLOR_ALIASES[normalized];
  }

  return null;
}

export function normalizeColorList(
  input: string[] | null | undefined,
  maxItems = 8
): CanonicalColor[] {
  if (!Array.isArray(input) || input.length === 0) return [];
  const output: CanonicalColor[] = [];
  const seen = new Set<CanonicalColor>();

  for (const entry of input) {
    const normalized = normalizeColorToken(entry);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(normalized);
    if (output.length >= maxItems) break;
  }

  return output;
}

export function getColorFamily(color: string | null | undefined): string | null {
  const normalized = normalizeColorToken(color);
  if (!normalized) return null;
  return FAMILY_BY_COLOR.get(normalized) ?? null;
}

export function expandColorRequestToFamily(input: string[]): CanonicalColor[] {
  const normalized = normalizeColorList(input, 16);
  if (normalized.length === 0) return [];

  const output: CanonicalColor[] = [];
  const seen = new Set<CanonicalColor>();

  for (const color of normalized) {
    const family = getColorFamily(color);
    if (!family) {
      if (!seen.has(color)) {
        seen.add(color);
        output.push(color);
      }
      continue;
    }

    const familyColors = COLOR_FAMILIES[family as keyof typeof COLOR_FAMILIES] ?? [];
    for (const familyColor of familyColors) {
      if (seen.has(familyColor)) continue;
      seen.add(familyColor);
      output.push(familyColor);
    }
  }

  return output;
}

export function getAdjacentColorFamilies(
  family: keyof typeof COLOR_FAMILIES
): Array<keyof typeof COLOR_FAMILIES> {
  return [...(COLOR_FAMILY_ADJACENCY[family] ?? [])];
}

export function isCanonicalColor(value: string | null | undefined): boolean {
  return normalizeColorToken(value) !== null;
}

export function extractCanonicalColorsFromText(
  text: string,
  maxItems = 6
): CanonicalColor[] {
  const normalized = normalizeText(text);
  if (!normalized) return [];

  const output: CanonicalColor[] = [];
  const seen = new Set<CanonicalColor>();

  for (const entry of COLOR_PARSE_INDEX) {
    const pattern = new RegExp(`\\b${escapeRegExp(entry.term)}\\b`, "i");
    if (!pattern.test(normalized)) continue;
    if (seen.has(entry.canonical)) continue;
    seen.add(entry.canonical);
    output.push(entry.canonical);
    if (output.length >= maxItems) break;
  }

  return output;
}
