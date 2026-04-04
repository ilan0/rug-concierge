#!/usr/bin/env tsx

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

type Shape = "area" | "runner" | "round";

type DatasetRecord = {
  sequence: number;
  stock_id: string;
  display_name: string;
  origin: string;
  style: string;
  condition: "excellent" | "good" | "fair";
  age_category: "new" | "vintage";
  dominant_color:
    | "blue"
    | "green"
    | "ivory"
    | "red"
    | "rust"
    | "gold"
    | "brown"
    | "multi"
    | "teal"
    | "black"
    | "gray";
  width_ft: number;
  width_in: number;
  length_ft: number;
  length_in: number;
  shape: Shape;
  expected_keywords: string[];
  image: {
    local_path: string;
    source: "openai";
    source_url: string;
    source_title: string;
    bytes: number;
    sha256: string;
  };
};

const DEFAULT_COUNT = 40;
const OPENAI_MODEL = "gpt-image-1";
const OPENAI_SIZE = "1024x1024";
const OPENAI_QUALITY = "medium";
const OUTPUT_FORMAT = "webp";

const STYLE_VARIANTS = [
  "modern abstract",
  "contemporary minimalist",
  "geometric modern",
  "scandinavian modern",
  "transitional modern",
  "clean-lined contemporary",
];

const COLOR_VARIANTS: Array<DatasetRecord["dominant_color"]> = [
  "blue",
  "gray",
  "ivory",
  "teal",
  "green",
  "brown",
  "black",
  "gold",
  "rust",
  "red",
  "multi",
];

const SIZE_SLOTS: Array<{
  shape: Shape;
  options: Array<[number, number, number, number]>;
  count: number;
}> = [
  { shape: "area", options: [[3, 0, 5, 0], [4, 0, 6, 0]], count: 4 },
  { shape: "area", options: [[5, 0, 8, 0], [6, 0, 9, 0]], count: 8 },
  { shape: "area", options: [[8, 0, 10, 0], [8, 0, 11, 0], [9, 0, 12, 0]], count: 16 },
  { shape: "area", options: [[10, 0, 14, 0], [11, 0, 15, 0]], count: 8 },
  { shape: "runner", options: [[2, 6, 10, 0], [3, 0, 12, 0]], count: 3 },
  { shape: "round", options: [[8, 0, 8, 0]], count: 1 },
];

function parseArgs() {
  const args = process.argv.slice(2);
  const out: Record<string, string> = {};
  for (const arg of args) {
    if (!arg.startsWith("--")) continue;
    const idx = arg.indexOf("=");
    if (idx === -1) {
      out[arg.slice(2)] = "true";
      continue;
    }
    out[arg.slice(2, idx)] = arg.slice(idx + 1);
  }
  return out;
}

function ensureDir(dirPath: string) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value.trim();
}

function buildSizeList(count: number): Array<{
  width_ft: number;
  width_in: number;
  length_ft: number;
  length_in: number;
  shape: Shape;
}> {
  const out: Array<{
    width_ft: number;
    width_in: number;
    length_ft: number;
    length_in: number;
    shape: Shape;
  }> = [];

  for (const row of SIZE_SLOTS) {
    for (let i = 0; i < row.count; i += 1) {
      const option = row.options[i % row.options.length] ?? [8, 0, 10, 0];
      out.push({
        width_ft: option[0],
        width_in: option[1],
        length_ft: option[2],
        length_in: option[3],
        shape: row.shape,
      });
    }
  }

  if (out.length < count) {
    throw new Error(`Not enough size slots (${out.length}) for count=${count}`);
  }

  return out.slice(0, count);
}

function buildPrompt(input: {
  style: string;
  color: DatasetRecord["dominant_color"];
  shape: Shape;
}): string {
  const shapeText =
    input.shape === "runner"
      ? "runner rug"
      : input.shape === "round"
        ? "round area rug"
        : "area rug";

  return [
    "Top-down studio product photo of a single modern rug.",
    `Style direction: ${input.style}.`,
    `Dominant tone direction: ${input.color}.`,
    `Shape: ${shapeText}.`,
    "Photorealistic woven textile texture, centered, full rug visible edge-to-edge.",
    "No furniture, no room scene, no people, no text, no watermark, neutral seamless background.",
  ].join(" ");
}

async function generateImage(input: {
  apiKey: string;
  prompt: string;
  sequence: number;
  outputDir: string;
}): Promise<{ path: string; bytes: number; sha256: string }> {
  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${input.apiKey}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      prompt: input.prompt,
      size: OPENAI_SIZE,
      quality: OPENAI_QUALITY,
      output_format: OUTPUT_FORMAT,
      n: 1,
    }),
  });

  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    const message =
      payload.error && typeof payload.error === "object"
        ? String((payload.error as Record<string, unknown>).message ?? "unknown")
        : "unknown";
    throw new Error(`Image generation failed (${response.status}): ${message}`);
  }

  const data = Array.isArray(payload.data) ? payload.data : [];
  const first = data[0];
  if (!first || typeof first !== "object") {
    throw new Error("Image generation response missing data[0]");
  }
  const b64 = (first as Record<string, unknown>).b64_json;
  if (typeof b64 !== "string" || b64.trim().length === 0) {
    throw new Error("Image generation response missing b64_json");
  }

  const bytes = Buffer.from(b64, "base64");
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  const filePath = path.join(input.outputDir, `${String(input.sequence).padStart(3, "0")}.webp`);
  fs.writeFileSync(filePath, bytes);
  return { path: filePath, bytes: bytes.length, sha256 };
}

function summarize(records: DatasetRecord[]) {
  const byStyle = new Map<string, number>();
  const byColor = new Map<string, number>();
  const byShape = new Map<string, number>();
  for (const row of records) {
    byStyle.set(row.style, (byStyle.get(row.style) ?? 0) + 1);
    byColor.set(row.dominant_color, (byColor.get(row.dominant_color) ?? 0) + 1);
    byShape.set(row.shape, (byShape.get(row.shape) ?? 0) + 1);
  }
  return {
    total: records.length,
    by_style: Object.fromEntries([...byStyle.entries()].sort((a, b) => b[1] - a[1])),
    by_color: Object.fromEntries([...byColor.entries()].sort((a, b) => b[1] - a[1])),
    by_shape: Object.fromEntries([...byShape.entries()].sort((a, b) => b[1] - a[1])),
  };
}

async function main() {
  const args = parseArgs();
  const count = Number.parseInt(args.count ?? String(DEFAULT_COUNT), 10);
  if (!Number.isFinite(count) || count <= 0) {
    throw new Error("--count must be a positive integer.");
  }

  const apiKey = requireEnv("OPENAI_API_KEY");
  const runId =
    args.run_id ??
    `modern-ai-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}`;
  const outputRoot = path.resolve(
    args.output_dir ?? `scripts/testing/live-intake/output/${runId}`
  );
  const imageDir = path.join(outputRoot, "images");
  ensureDir(imageDir);

  const sizes = buildSizeList(count);
  const records: DatasetRecord[] = [];
  const seenHashes = new Set<string>();

  for (let i = 0; i < count; i += 1) {
    const style = STYLE_VARIANTS[i % STYLE_VARIANTS.length] ?? "contemporary";
    const color = COLOR_VARIANTS[i % COLOR_VARIANTS.length] ?? "multi";
    const size = sizes[i];
    if (!size) continue;

    let generated:
      | { path: string; bytes: number; sha256: string }
      | null = null;
    let attempts = 0;
    while (!generated && attempts < 5) {
      attempts += 1;
      const prompt = buildPrompt({
        style,
        color,
        shape: size.shape,
      });
      const result = await generateImage({
        apiKey,
        prompt,
        sequence: i + 1,
        outputDir: imageDir,
      });
      if (seenHashes.has(result.sha256)) {
        fs.rmSync(result.path, { force: true });
        continue;
      }
      seenHashes.add(result.sha256);
      generated = result;
    }

    if (!generated) {
      throw new Error(`Could not generate unique image for sequence=${i + 1}`);
    }

    const stockSuffix = String(i + 1).padStart(3, "0");
    const stockId = `LIVE-MOD-${runId.replace(/[^0-9]/g, "").slice(0, 8) || "20260327"}-${stockSuffix}`;
    const condition: DatasetRecord["condition"] =
      i % 10 === 0 ? "fair" : i % 3 === 0 ? "good" : "excellent";
    const age: DatasetRecord["age_category"] = i % 8 === 0 ? "vintage" : "new";

    records.push({
      sequence: i + 1,
      stock_id: stockId,
      display_name: `Modern ${style} Rug ${stockSuffix}`,
      origin: "Contemporary",
      style,
      condition,
      age_category: age,
      dominant_color: color,
      width_ft: size.width_ft,
      width_in: size.width_in,
      length_ft: size.length_ft,
      length_in: size.length_in,
      shape: size.shape,
      expected_keywords: ["modern", "contemporary", "abstract", "geometric", "minimalist"],
      image: {
        local_path: generated.path,
        source: "openai",
        source_url: "https://api.openai.com/v1/images/generations",
        source_title: `OpenAI modern rug prompt ${i + 1}`,
        bytes: generated.bytes,
        sha256: generated.sha256,
      },
    });

    // mild pacing to avoid burst rate limits
    await sleep(250);
    console.log(`[modern-ai-dataset] generated ${i + 1}/${count}`);
  }

  const datasetPath = path.join(outputRoot, "dataset.json");
  const summaryPath = path.join(outputRoot, "dataset-summary.json");
  fs.writeFileSync(datasetPath, `${JSON.stringify(records, null, 2)}\n`, "utf8");
  fs.writeFileSync(summaryPath, `${JSON.stringify(summarize(records), null, 2)}\n`, "utf8");

  console.log(`[modern-ai-dataset] wrote ${records.length} records to ${datasetPath}`);
  console.log(`[modern-ai-dataset] summary: ${summaryPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

