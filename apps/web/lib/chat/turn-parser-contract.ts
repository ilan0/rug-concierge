import { z } from "zod";

export const TURN_MODE_VALUES = [
  "recommendation",
  "recommendation_followup",
  "discovery",
  "advice",
  "chat",
] as const;

export const TURN_INTENT_VALUES = [
  "recommend",
  "educate",
  "followup",
  "reaction",
  "general",
] as const;

export const FOLLOWUP_INTENT_VALUES = [
  "none",
  "closest",
  "larger",
  "smaller",
  "more_like_this",
  "tighten",
] as const;

export const CONSTRAINT_STRICTNESS_VALUES = ["must", "prefer"] as const;

export const SHAPE_VALUES = ["runner", "round_oval", "area", "oversized"] as const;

export const turnParserSizeConstraintSchema = z
  .object({
    widthIn: z.number().finite().positive(),
    lengthIn: z.number().finite().positive(),
  })
  .strict();

export const turnParserConstraintsSchema = z
  .object({
    size: turnParserSizeConstraintSchema.nullable().optional(),
    colors: z.array(z.string().trim().min(1).max(32)).max(8).default([]),
    styles: z.array(z.string().trim().min(1).max(48)).max(8).default([]),
    shape: z.enum(SHAPE_VALUES).nullable().optional(),
  })
  .strict();

export const turnParserStrictnessSchema = z
  .object({
    size: z.enum(CONSTRAINT_STRICTNESS_VALUES).default("prefer"),
    colors: z.enum(CONSTRAINT_STRICTNESS_VALUES).default("prefer"),
    styles: z.enum(CONSTRAINT_STRICTNESS_VALUES).default("prefer"),
    shape: z.enum(CONSTRAINT_STRICTNESS_VALUES).default("prefer"),
  })
  .strict();

export const turnParserAvoidSchema = z
  .object({
    colors: z.array(z.string().trim().min(1).max(32)).max(8).default([]),
    styles: z.array(z.string().trim().min(1).max(48)).max(8).default([]),
    shapes: z.array(z.enum(SHAPE_VALUES)).max(4).default([]),
  })
  .strict();

export const parsedTurnSchema = z
  .object({
    intent: z.enum(TURN_INTENT_VALUES).default("general"),
    mode: z.enum(TURN_MODE_VALUES),
    followup_intent: z.enum(FOLLOWUP_INTENT_VALUES).default("none"),
    constraints: turnParserConstraintsSchema.default({ colors: [], styles: [] }),
    strictness: turnParserStrictnessSchema.default({
      size: "prefer",
      colors: "prefer",
      styles: "prefer",
      shape: "prefer",
    }),
    avoid: turnParserAvoidSchema.default({
      colors: [],
      styles: [],
      shapes: [],
    }),
    session_facts: z.array(z.string().trim().min(1).max(120)).max(12).default([]),
    referenced_rug_id: z.string().trim().min(1).max(80).optional(),
    referenced_rug_label: z.string().trim().min(1).max(160).optional(),
    rug_reference_ambiguous: z.boolean().default(false),
    confidence: z.enum(["high", "medium", "low"]).default("medium"),
  })
  .strict();

export type ParsedTurn = z.infer<typeof parsedTurnSchema>;

export const TURN_PARSER_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "intent",
    "mode",
    "followup_intent",
    "constraints",
    "strictness",
    "avoid",
    "session_facts",
    "rug_reference_ambiguous",
    "confidence",
  ],
  properties: {
    intent: {
      type: "string",
      enum: TURN_INTENT_VALUES,
    },
    mode: {
      type: "string",
      enum: TURN_MODE_VALUES,
    },
    followup_intent: {
      type: "string",
      enum: FOLLOWUP_INTENT_VALUES,
    },
    constraints: {
      type: "object",
      additionalProperties: false,
      required: ["size", "colors", "styles", "shape"],
      properties: {
        size: {
          anyOf: [
            { type: "null" },
            {
              type: "object",
              additionalProperties: false,
              required: ["widthIn", "lengthIn"],
              properties: {
                widthIn: { type: "number" },
                lengthIn: { type: "number" },
              },
            },
          ],
        },
        colors: {
          type: "array",
          items: { type: "string", maxLength: 32 },
          maxItems: 8,
        },
        styles: {
          type: "array",
          items: { type: "string", maxLength: 48 },
          maxItems: 8,
        },
        shape: {
          anyOf: [{ type: "null" }, { type: "string", enum: SHAPE_VALUES }],
        },
      },
    },
    strictness: {
      type: "object",
      additionalProperties: false,
      required: ["size", "colors", "styles", "shape"],
      properties: {
        size: { type: "string", enum: CONSTRAINT_STRICTNESS_VALUES },
        colors: { type: "string", enum: CONSTRAINT_STRICTNESS_VALUES },
        styles: { type: "string", enum: CONSTRAINT_STRICTNESS_VALUES },
        shape: { type: "string", enum: CONSTRAINT_STRICTNESS_VALUES },
      },
    },
    avoid: {
      type: "object",
      additionalProperties: false,
      required: ["colors", "styles", "shapes"],
      properties: {
        colors: {
          type: "array",
          items: { type: "string", maxLength: 32 },
          maxItems: 8,
        },
        styles: {
          type: "array",
          items: { type: "string", maxLength: 48 },
          maxItems: 8,
        },
        shapes: {
          type: "array",
          items: { type: "string", enum: SHAPE_VALUES },
          maxItems: 4,
        },
      },
    },
    session_facts: {
      type: "array",
      items: { type: "string", maxLength: 120 },
      maxItems: 12,
    },
    referenced_rug_id: {
      type: "string",
      maxLength: 80,
    },
    referenced_rug_label: {
      type: "string",
      maxLength: 160,
    },
    rug_reference_ambiguous: {
      type: "boolean",
    },
    confidence: {
      type: "string",
      enum: ["high", "medium", "low"],
    },
  },
} as const;
