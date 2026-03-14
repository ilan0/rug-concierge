#!/usr/bin/env tsx

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const MAX_CONCURRENCY = 2;
const BATCH_DELAY_MS = 1000;
const MAX_429_RETRIES = 3;

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

const aiStructuredFieldsSchema = z
  .object({
    origin: z
      .enum([
        "Persian",
        "Afghan",
        "Turkish",
        "Indian",
        "Caucasian",
        "Pakistani",
        "Other",
      ])
      .nullable()
      .optional(),
    style: z.string().trim().min(1).max(80).nullable().optional(),
    pattern: z.array(z.string().trim().min(1).max(48)).max(8).nullable().optional(),
    primary_colors: z
      .array(z.string().trim().min(1).max(32))
      .max(8)
      .nullable()
      .optional(),
    age_category: z
      .enum(["antique", "semi-antique", "vintage", "new"])
      .nullable()
      .optional(),
    mood: z
      .enum(["traditional", "transitional", "eclectic", "modern"])
      .nullable()
      .optional(),
  })
  .strict();

const visionEnrichmentSchema = z
  .object({
    intake_label: z.string().trim().min(1).max(120),
    ai_description: z.string().trim().min(1).max(1200),
    ai_structured_fields: aiStructuredFieldsSchema.nullable().optional(),
  })
  .strict();

type ScriptOptions = {
  tenantId: string;
  force: boolean;
  dryRun: boolean;
};

type RugRow = {
  id: string;
  width_total_in: number | null;
  length_total_in: number | null;
};

type VisionEnrichmentResult = {
  intakeLabel: string;
  aiDescription: string;
  aiStructuredFields: z.infer<typeof aiStructuredFieldsSchema> | null;
};

function loadLocalEnvFile() {
  const filePath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(filePath)) return;

  const content = fs.readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const equalsIndex = line.indexOf("=");
    if (equalsIndex <= 0) continue;

    const key = line.slice(0, equalsIndex).trim();
    let value = line.slice(equalsIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function parseArgs(argv: string[]): ScriptOptions {
  const options: ScriptOptions = {
    tenantId: "",
    force: false,
    dryRun: false,
  };

  for (const arg of argv) {
    if (arg.startsWith("--tenant-id=")) {
      options.tenantId = arg.slice("--tenant-id=".length).trim();
      continue;
    }
    if (arg === "--force") {
      options.force = true;
      continue;
    }
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!options.tenantId) {
    options.tenantId = (process.env.TENANT_ID ?? "").trim();
  }
  if (!options.tenantId) {
    throw new Error("Missing --tenant-id=<uuid> (or TENANT_ID env var).");
  }

  return options;
}

function assertEnv(name: string): string {
  const value = (process.env[name] ?? "").trim();
  if (!value) {
    throw new Error(`Missing ${name} environment variable.`);
  }
  return value;
}

function toPlainText(value: string): string {
  return value
    .replace(/\*\*/g, "")
    .replace(/[_`#]/g, "")
    .replace(/^\s*[-*•]+\s*/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

function formatFeetAndInches(totalIn: number): string {
  const feet = Math.floor(totalIn / 12);
  const inches = totalIn % 12;
  if (inches === 0) return `${feet}'`;
  return `${feet}'${inches}"`;
}

function formatSize(widthIn: number | null, lengthIn: number | null): string | null {
  if (typeof widthIn !== "number" || typeof lengthIn !== "number") return null;
  return `${formatFeetAndInches(widthIn)} × ${formatFeetAndInches(lengthIn)}`;
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

function normalizeStructuredFields(
  value: z.infer<typeof aiStructuredFieldsSchema> | null | undefined
): z.infer<typeof aiStructuredFieldsSchema> | null {
  if (!value) return null;

  const normalized: z.infer<typeof aiStructuredFieldsSchema> = {};
  if (value.origin) normalized.origin = value.origin;
  if (value.style) normalized.style = toPlainText(value.style).slice(0, 80);
  if (Array.isArray(value.pattern) && value.pattern.length > 0) {
    const next = value.pattern
      .map((item) => toPlainText(item).slice(0, 48))
      .filter((item) => item.length > 0);
    if (next.length > 0) normalized.pattern = next.slice(0, 8);
  }
  if (Array.isArray(value.primary_colors) && value.primary_colors.length > 0) {
    const next = value.primary_colors
      .map((item) => toPlainText(item).slice(0, 32).toLowerCase())
      .filter((item) => item.length > 0);
    if (next.length > 0) normalized.primary_colors = next.slice(0, 8);
  }
  if (value.age_category) normalized.age_category = value.age_category;
  if (value.mood) normalized.mood = value.mood;

  return Object.keys(normalized).length > 0 ? normalized : null;
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
      aiStructuredFields: normalizeStructuredFields(validated.data.ai_structured_fields),
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
      // Fallback to JSON part parsing below.
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

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestVisionEnrichment(input: {
  imageUrl: string;
  widthTotalIn: number | null;
  lengthTotalIn: number | null;
}): Promise<VisionEnrichmentResult | null> {
  const apiKey = assertEnv("OPENAI_API_KEY");
  const sizeDisplay = formatSize(input.widthTotalIn, input.lengthTotalIn);

  const requestPayload = {
    model: "gpt-4o",
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text:
              "You are an expert rug appraiser. Analyze the rug in this photo and return valid JSON only. Use measured size as context for scale only. Never include dimensions in the intake_label. Leave uncertain fields as null and unknown list fields as empty arrays.\\n\\nReturn shape:\\n{\\n  \\\"intake_label\\\": \\\"3-6 words, descriptive, no dimensions\\\",\\n  \\\"ai_description\\\": \\\"2-4 sentences: style tradition, palette, motifs, room fit\\\",\\n  \\\"ai_structured_fields\\\": {\\n    \\\"origin\\\": \\\"Persian|Afghan|Turkish|Indian|Caucasian|Pakistani|Other|null\\\",\\n    \\\"style\\\": \\\"named style like Heriz/Serapi/Gabbeh/Kilim or null\\\",\\n    \\\"pattern\\\": [\\\"medallion center\\\", \\\"all-over pattern\\\", \\\"geometric design\\\", \\\"floral motif\\\", \\\"tribal design\\\", \\\"floral border\\\", \\\"pictorial\\\", \\\"plain field\\\"],\\n    \\\"primary_colors\\\": [\\\"red\\\",\\\"navy\\\",\\\"ivory\\\",\\\"gold\\\",\\\"rust\\\",\\\"teal\\\",\\\"brown\\\",\\\"green\\\",\\\"blue\\\",\\\"black\\\",\\\"cream\\\",\\\"coral\\\"],\\n    \\\"age_category\\\": \\\"antique|semi-antique|vintage|new|null\\\",\\n    \\\"mood\\\": \\\"traditional|transitional|eclectic|modern|null\\\"\\n  }\\n}",
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

  for (let attempt = 0; attempt <= MAX_429_RETRIES; attempt += 1) {
    const response = await fetch(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestPayload),
    }).catch(() => null);

    if (!response) return null;

    if (response.status === 429 && attempt < MAX_429_RETRIES) {
      await sleep((attempt + 1) * 1000);
      continue;
    }

    if (!response.ok) return null;

    const payload = (await response.json().catch(() => null)) as unknown;
    return parseVisionPayload(payload);
  }

  return null;
}

async function fetchTargetRugs(input: {
  supabase: ReturnType<typeof createClient>;
  tenantId: string;
  force: boolean;
}): Promise<RugRow[]> {
  let query = input.supabase
    .from("rugs")
    .select("id, width_total_in, length_total_in")
    .eq("tenant_id", input.tenantId)
    .order("created_at", { ascending: true });

  if (!input.force) {
    query = query.is("ai_structured_fields", null);
  }

  const { data, error } = await query;
  if (error || !Array.isArray(data)) {
    throw new Error(error?.message ?? "Failed to query rugs.");
  }

  return data
    .map((row) => ({
      id: typeof row.id === "string" ? row.id : "",
      width_total_in:
        typeof row.width_total_in === "number" && Number.isFinite(row.width_total_in)
          ? row.width_total_in
          : null,
      length_total_in:
        typeof row.length_total_in === "number" && Number.isFinite(row.length_total_in)
          ? row.length_total_in
          : null,
    }))
    .filter((row) => row.id.length > 0);
}

async function fetchPrimaryImageUrls(input: {
  supabase: ReturnType<typeof createClient>;
  tenantId: string;
  rugIds: string[];
}): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (input.rugIds.length === 0) return map;

  const { data, error } = await input.supabase
    .from("rug_images")
    .select("rug_id, path")
    .eq("tenant_id", input.tenantId)
    .in("rug_id", input.rugIds);

  if (error || !Array.isArray(data)) {
    throw new Error(error?.message ?? "Failed to query rug_images.");
  }

  for (const row of data) {
    if (!row || typeof row !== "object") continue;
    const rugId = typeof row.rug_id === "string" ? row.rug_id : null;
    const pathValue = typeof row.path === "string" ? row.path.trim() : "";
    if (!rugId || !pathValue) continue;
    if (map.has(rugId)) continue;

    const { data: publicData } = input.supabase.storage
      .from("rug-images")
      .getPublicUrl(pathValue.replace(/^\/+/, ""));

    if (publicData.publicUrl) {
      map.set(rugId, publicData.publicUrl);
    }
  }

  return map;
}

async function enrichOneRug(input: {
  supabase: ReturnType<typeof createClient>;
  tenantId: string;
  rug: RugRow;
  imageUrl: string;
  dryRun: boolean;
}) {
  const enrichment = await requestVisionEnrichment({
    imageUrl: input.imageUrl,
    widthTotalIn: input.rug.width_total_in,
    lengthTotalIn: input.rug.length_total_in,
  });

  if (!enrichment) {
    throw new Error("Vision enrichment failed or returned invalid payload.");
  }

  if (input.dryRun) {
    return {
      rugId: input.rug.id,
      label: enrichment.intakeLabel,
      updated: false,
    };
  }

  const { error } = await input.supabase
    .from("rugs")
    .update({
      intake_label: enrichment.intakeLabel,
      ai_description: enrichment.aiDescription,
      ai_structured_fields: enrichment.aiStructuredFields,
    })
    .eq("tenant_id", input.tenantId)
    .eq("id", input.rug.id);

  if (error) {
    throw new Error(error.message);
  }

  return {
    rugId: input.rug.id,
    label: enrichment.intakeLabel,
    updated: true,
  };
}

async function main() {
  loadLocalEnvFile();
  const options = parseArgs(process.argv.slice(2));

  const supabaseUrl = assertEnv("SUPABASE_URL");
  const supabaseSecretKey = assertEnv("SUPABASE_SECRET_KEY");
  const supabase = createClient(supabaseUrl, supabaseSecretKey, {
    auth: { persistSession: false },
  });

  console.log("[re-enrich] starting", {
    tenant_id: options.tenantId,
    force: options.force,
    dry_run: options.dryRun,
    concurrency: MAX_CONCURRENCY,
  });

  const rugs = await fetchTargetRugs({
    supabase,
    tenantId: options.tenantId,
    force: options.force,
  });

  if (rugs.length === 0) {
    console.log("[re-enrich] no rugs matched the query.");
    return;
  }

  const imageMap = await fetchPrimaryImageUrls({
    supabase,
    tenantId: options.tenantId,
    rugIds: rugs.map((rug) => rug.id),
  });

  let successCount = 0;
  let failedCount = 0;
  let skippedNoImageCount = 0;

  for (let index = 0; index < rugs.length; index += MAX_CONCURRENCY) {
    const batch = rugs.slice(index, index + MAX_CONCURRENCY);

    await Promise.all(
      batch.map(async (rug) => {
        const imageUrl = imageMap.get(rug.id);
        if (!imageUrl) {
          skippedNoImageCount += 1;
          console.warn("[re-enrich] skipped (missing image)", { rug_id: rug.id });
          return;
        }

        try {
          const result = await enrichOneRug({
            supabase,
            tenantId: options.tenantId,
            rug,
            imageUrl,
            dryRun: options.dryRun,
          });
          successCount += 1;
          console.log("[re-enrich] success", {
            rug_id: result.rugId,
            label: result.label,
            dry_run: options.dryRun,
          });
        } catch (error) {
          failedCount += 1;
          console.error("[re-enrich] failed", {
            rug_id: rug.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      })
    );

    if (index + MAX_CONCURRENCY < rugs.length) {
      await sleep(BATCH_DELAY_MS);
    }
  }

  console.log("[re-enrich] done", {
    total: rugs.length,
    succeeded: successCount,
    failed: failedCount,
    skipped_missing_image: skippedNoImageCount,
    dry_run: options.dryRun,
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
