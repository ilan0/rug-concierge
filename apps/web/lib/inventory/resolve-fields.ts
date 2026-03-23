import type {
  EffectiveRugFields,
  RugAiStructuredFields,
  StaffOverrides,
} from "@/lib/types/inventory";
import { resolveStyleValue } from "@/lib/inventory/style-normalization";

function hasOwn(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function normalizeOverrides(
  overrides: StaffOverrides | null | undefined
): Partial<StaffOverrides> {
  if (!overrides) return {};

  const normalized: Partial<StaffOverrides> = {};
  for (const [key, value] of Object.entries(overrides)) {
    if (value === null || value === undefined) continue;
    (normalized as Record<string, unknown>)[key] = value;
  }
  return normalized;
}

export function resolveEffectiveFields(
  intakeLabel: string | null,
  aiFields: RugAiStructuredFields | null,
  staffOverrides: StaffOverrides | null,
  aiDescription: string | null = null
): EffectiveRugFields {
  const normalizedOverrides = normalizeOverrides(staffOverrides);
  const base = aiFields ?? {};
  const normalizedAiStyle = resolveStyleValue({
    styleRaw: base.style ?? null,
    pattern: base.pattern ?? [],
    mood: base.mood ?? null,
    aiDescription,
  });

  return {
    label:
      (hasOwn(normalizedOverrides, "label")
        ? normalizedOverrides.label
        : intakeLabel) ?? "Untitled Rug",
    origin:
      (hasOwn(normalizedOverrides, "origin")
        ? normalizedOverrides.origin
        : base.origin) ?? null,
    style:
      (hasOwn(normalizedOverrides, "style")
        ? normalizedOverrides.style
        : normalizedAiStyle) ?? null,
    pattern:
      (hasOwn(normalizedOverrides, "pattern")
        ? normalizedOverrides.pattern
        : base.pattern) ?? null,
    primary_colors:
      (hasOwn(normalizedOverrides, "primary_colors")
        ? normalizedOverrides.primary_colors
        : base.primary_colors) ?? null,
    age_category:
      (hasOwn(normalizedOverrides, "age_category")
        ? normalizedOverrides.age_category
        : base.age_category) ?? null,
    mood:
      (hasOwn(normalizedOverrides, "mood")
        ? normalizedOverrides.mood
        : base.mood) ?? null,
  };
}

export function mergeStaffOverrides(
  current: StaffOverrides | null,
  patch: StaffOverrides
): StaffOverrides | null {
  const merged: Record<string, unknown> = { ...normalizeOverrides(current) };

  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete merged[key];
      continue;
    }
    if (value === undefined) continue;
    merged[key] = value;
  }

  return Object.keys(merged).length > 0 ? (merged as StaffOverrides) : null;
}
