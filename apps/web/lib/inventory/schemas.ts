import { z } from "zod";
import { CANONICAL_COLORS } from "@/lib/config/color-taxonomy";
import { RUG_CONFIDENCE_VALUES } from "@/lib/inventory/confidence";

export const RUG_ORIGIN_VALUES = [
  "Persian",
  "Afghan",
  "Turkish",
  "Indian",
  "Caucasian",
  "Pakistani",
  "Moroccan",
  "Central Asian",
  "Other",
] as const;

export const RUG_AGE_CATEGORY_VALUES = [
  "antique",
  "semi-antique",
  "vintage",
  "traditional",
  "contemporary",
  "new",
] as const;

export const RUG_MOOD_VALUES = [
  "traditional",
  "transitional",
  "eclectic",
  "modern",
] as const;

export const RUG_DETECTION_CONFIDENCE_VALUES = [
  "low",
  "medium",
  "high",
] as const;

const stringArrayField = (maxItems: number, maxChars: number) =>
  z.array(z.string().trim().min(1).max(maxChars)).max(maxItems).nullable().optional();

const canonicalColorArrayField = () =>
  z.array(z.enum(CANONICAL_COLORS)).max(8).nullable().optional();

export const aiStructuredFieldsSchema = z
  .object({
    origin: z.enum(RUG_ORIGIN_VALUES).nullable().optional(),
    origin_confidence: z.enum(RUG_CONFIDENCE_VALUES).nullable().optional(),
    style: z.string().trim().min(1).max(80).nullable().optional(),
    style_confidence: z.enum(RUG_CONFIDENCE_VALUES).nullable().optional(),
    pattern: stringArrayField(8, 48),
    primary_colors: canonicalColorArrayField(),
    age_category: z.enum(RUG_AGE_CATEGORY_VALUES).nullable().optional(),
    mood: z.enum(RUG_MOOD_VALUES).nullable().optional(),
    is_rug: z.boolean().nullable().optional(),
    is_rug_confidence: z.enum(RUG_DETECTION_CONFIDENCE_VALUES).nullable().optional(),
  })
  .strict();

export const visionEnrichmentSchema = z
  .object({
    intake_label: z.string().trim().min(1).max(120),
    ai_description: z.string().trim().min(1).max(1200),
    ai_structured_fields: aiStructuredFieldsSchema.nullable().optional(),
  })
  .strict();

export const staffOverridesSchema = z
  .object({
    label: z.string().trim().min(1).max(120).nullable().optional(),
    origin: z.string().trim().min(1).max(60).nullable().optional(),
    style: z.string().trim().min(1).max(80).nullable().optional(),
    pattern: stringArrayField(8, 48),
    primary_colors: canonicalColorArrayField(),
    age_category: z.enum(RUG_AGE_CATEGORY_VALUES).nullable().optional(),
    mood: z.enum(RUG_MOOD_VALUES).nullable().optional(),
  })
  .strict();

export type ParsedAiStructuredFields = z.infer<typeof aiStructuredFieldsSchema>;
export type ParsedStaffOverrides = z.infer<typeof staffOverridesSchema>;
export type ParsedVisionEnrichment = z.infer<typeof visionEnrichmentSchema>;
