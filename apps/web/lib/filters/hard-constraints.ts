import type { HardConstraints, InventoryRug } from "@/lib/types/recommendation";
import {
  getSizeBounds,
  matchesSizeWithBounds,
  matchesSizeWithWindow,
  type SizeWindow,
} from "@/lib/filters/size-bounds";
import { resolveEffectiveFields } from "@/lib/inventory/resolve-fields";

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

const STYLE_ALIASES: Record<string, string[]> = {
  kazak: ["caucasian kazak", "kazakh"],
  oushak: ["ushak"],
  kilim: ["flatweave", "flat weave"],
  heriz: ["serapi"],
  serapi: ["heriz"],
  bokhara: ["bukhara"],
  turkmen: ["turkoman"],
  baluch: ["baluchi"],
  tribal: ["nomadic"],
  geometric: ["geometric tribal"],
};

const MODERN_STYLE_MARKERS = [
  "modern",
  "contemporary",
  "minimal",
  "minimalist",
  "abstract",
  "transitional",
] as const;

const TRADITIONAL_STYLE_MARKERS = [
  "traditional",
  "tribal",
  "persian",
  "heriz",
  "serapi",
  "kashan",
  "tabriz",
  "isfahan",
  "sultanabad",
  "oushak",
  "kazak",
  "karabagh",
  "bidjar",
] as const;

const STYLE_FAMILY_OVERRIDES: Record<
  string,
  { include: string[]; exclude: string[] }
> = {
  modern: {
    include: [...MODERN_STYLE_MARKERS],
    exclude: [...TRADITIONAL_STYLE_MARKERS],
  },
  contemporary: {
    include: [...MODERN_STYLE_MARKERS],
    exclude: [...TRADITIONAL_STYLE_MARKERS],
  },
  minimal: {
    include: [...MODERN_STYLE_MARKERS],
    exclude: [...TRADITIONAL_STYLE_MARKERS],
  },
  minimalist: {
    include: [...MODERN_STYLE_MARKERS],
    exclude: [...TRADITIONAL_STYLE_MARKERS],
  },
  abstract: {
    include: [...MODERN_STYLE_MARKERS],
    exclude: [...TRADITIONAL_STYLE_MARKERS],
  },
  traditional: {
    include: [...TRADITIONAL_STYLE_MARKERS],
    exclude: [...MODERN_STYLE_MARKERS],
  },
  persian: {
    include: [
      "persian",
      "heriz",
      "serapi",
      "kashan",
      "tabriz",
      "isfahan",
      "sultanabad",
      "bidjar",
      "malayer",
      "sarouk",
      "qom",
    ],
    exclude: [...MODERN_STYLE_MARKERS],
  },
  tribal: {
    include: [...TRADITIONAL_STYLE_MARKERS],
    exclude: [...MODERN_STYLE_MARKERS],
  },
};

function toSearchText(rug: InventoryRug): string {
  const fields = rug.effective_fields
    ? rug.effective_fields
    : resolveEffectiveFields(
        rug.intake_label ?? null,
        rug.ai_structured_fields ?? null,
        rug.staff_overrides ?? null,
        rug.ai_description ?? null
      );

  const parts: string[] = [
    rug.intake_label ?? "",
    rug.ai_description ?? "",
    fields.label ?? "",
    fields.origin ?? "",
    fields.style ?? "",
    fields.mood ?? "",
    ...(fields.pattern ?? []),
    ...(fields.primary_colors ?? []),
  ];

  return normalizeText(parts.join(" "));
}

function toStyles(rug: InventoryRug): string[] {
  const fields = rug.effective_fields
    ? rug.effective_fields
    : resolveEffectiveFields(
        rug.intake_label ?? null,
        rug.ai_structured_fields ?? null,
        rug.staff_overrides ?? null,
        rug.ai_description ?? null
      );

  const styleTokens = [
    fields.style ?? "",
    fields.origin ?? "",
    ...(fields.pattern ?? []),
  ];
  const expanded = styleTokens
    .map((value) => normalizeText(value))
    .filter((value) => value.length > 0)
    .flatMap((value) => [value, ...value.split(" ").filter(Boolean)]);

  return Array.from(new Set(expanded));
}

function isRunnerByDimensions(
  widthTotalIn: number,
  lengthTotalIn: number
): boolean {
  const shortSide = Math.min(widthTotalIn, lengthTotalIn);
  const longSide = Math.max(widthTotalIn, lengthTotalIn);
  if (shortSide <= 0 || longSide <= 0) return false;
  return shortSide <= 42 && longSide >= 84 && longSide / shortSide >= 2.2;
}

function isOversizedByDimensions(
  widthTotalIn: number,
  lengthTotalIn: number
): boolean {
  const shortSide = Math.min(widthTotalIn, lengthTotalIn);
  const longSide = Math.max(widthTotalIn, lengthTotalIn);
  return shortSide >= 84 && longSide >= 133;
}

function hasRoundOvalKeyword(rug: InventoryRug): boolean {
  const text = toSearchText(rug);
  return /\b(round|circular|circle|oval)\b/.test(text);
}

function matchesShape(rug: InventoryRug, constraints: HardConstraints): boolean {
  if (!constraints.shape) return true;

  const width = rug.width_total_in;
  const length = rug.length_total_in;
  const hasDimensions = typeof width === "number" && typeof length === "number";

  if (constraints.shape === "round_oval") {
    return hasRoundOvalKeyword(rug);
  }

  if (!hasDimensions) return false;

  const isRunner = isRunnerByDimensions(width, length);
  const isOversized = isOversizedByDimensions(width, length);
  const isRoundOval = hasRoundOvalKeyword(rug);

  if (constraints.shape === "runner") return isRunner;
  if (constraints.shape === "oversized") return isOversized;
  if (constraints.shape === "area") {
    return !isRunner && !isRoundOval;
  }

  return true;
}

function matchesStyles(rug: InventoryRug, constraints: HardConstraints): boolean {
  if (!constraints.styles || constraints.styles.length === 0) return true;

  const wanted = constraints.styles.map((value) => normalizeText(value));
  const styleTokens = new Set(toStyles(rug));
  const searchText = toSearchText(rug);
  const strictTerms = new Set<string>([
    ...MODERN_STYLE_MARKERS,
    ...TRADITIONAL_STYLE_MARKERS,
  ]);

  const matchesAnyRequested = wanted.some((token) => {
    const family = STYLE_FAMILY_OVERRIDES[token];
    const candidateTerms = [
      token,
      ...(STYLE_ALIASES[token] ?? []),
      ...(family?.include ?? []),
    ];
    return candidateTerms.some((term) => {
      if (strictTerms.has(term)) {
        return styleTokens.has(term);
      }
      return styleTokens.has(term) || searchText.includes(term);
    });
  });
  if (!matchesAnyRequested) return false;

  const hasTraditionalCandidate = TRADITIONAL_STYLE_MARKERS.some(
    (token) => styleTokens.has(token) || searchText.includes(token)
  );
  const hasPersianCandidate = [
    "persian",
    "heriz",
    "serapi",
    "kashan",
    "tabriz",
    "isfahan",
    "sultanabad",
    "bidjar",
    "malayer",
    "sarouk",
    "qom",
  ].some((token) => styleTokens.has(token) || searchText.includes(token));
  const hasModernCandidate = MODERN_STYLE_MARKERS.some(
    (token) => styleTokens.has(token) || searchText.includes(token)
  );
  const requestedModern = wanted.some((token) =>
    MODERN_STYLE_MARKERS.includes(token as (typeof MODERN_STYLE_MARKERS)[number])
  );
  const requestedTraditional = wanted.some((token) =>
    TRADITIONAL_STYLE_MARKERS.includes(
      token as (typeof TRADITIONAL_STYLE_MARKERS)[number]
    )
  );

  if (requestedModern && hasTraditionalCandidate) {
    return false;
  }
  if (requestedTraditional && hasModernCandidate) {
    return false;
  }
  if (wanted.includes("persian") && !hasPersianCandidate) {
    return false;
  }

  return true;
}

function matchesSize(
  rug: InventoryRug,
  constraints: HardConstraints,
  sizeWindow?: SizeWindow | null
): boolean {
  if (sizeWindow) {
    if (
      typeof rug.width_total_in !== "number" ||
      typeof rug.length_total_in !== "number"
    ) {
      return false;
    }

    return matchesSizeWithWindow(
      rug.width_total_in,
      rug.length_total_in,
      sizeWindow
    );
  }

  const bounds = getSizeBounds(constraints.size);
  if (!bounds) return true;

  if (
    typeof rug.width_total_in !== "number" ||
    typeof rug.length_total_in !== "number"
  ) {
    return false;
  }

  return matchesSizeWithBounds(rug.width_total_in, rug.length_total_in, bounds);
}

export function filterByHardConstraints(
  inventory: InventoryRug[],
  constraints: HardConstraints,
  sizeWindow?: SizeWindow | null
): InventoryRug[] {
  return inventory.filter((rug) => {
    if (rug.status !== "available") return false;
    if (!matchesSize(rug, constraints, sizeWindow)) return false;
    if (!matchesStyles(rug, constraints)) return false;
    if (!matchesShape(rug, constraints)) return false;
    return true;
  });
}
