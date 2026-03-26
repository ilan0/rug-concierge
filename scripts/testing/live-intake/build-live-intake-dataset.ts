#!/usr/bin/env tsx

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

type SourceKind = "wikimedia" | "met";

type DownloadedImage = {
  local_path: string;
  source: SourceKind;
  source_url: string;
  source_title: string;
  bytes: number;
  sha256: string;
};

type RugRecord = {
  sequence: number;
  stock_id: string;
  display_name: string;
  origin: string;
  style: string;
  condition: "excellent" | "good" | "fair" | "notable_wear";
  age_category: "antique" | "semi-antique" | "vintage" | "new";
  dominant_color:
    | "blue"
    | "green"
    | "ivory"
    | "red"
    | "rust"
    | "gold"
    | "brown"
    | "multi"
    | "navy"
    | "teal"
    | "black"
    | "gray";
  width_ft: number;
  width_in: number;
  length_ft: number;
  length_in: number;
  shape: "area" | "runner" | "round" | "oval";
  image: DownloadedImage;
  expected_keywords: string[];
};

type WikimediaCandidate = {
  source: "wikimedia";
  image_url: string;
  source_url: string;
  title: string;
};

type MetCandidate = {
  source: "met";
  image_url: string;
  source_url: string;
  title: string;
};

type ImageCandidate = WikimediaCandidate | MetCandidate;

const DEFAULT_COUNT = 200;
const IMAGE_TIMEOUT_MS = 30_000;
const MIN_IMAGE_BYTES = 35_000;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const ORIGIN_PLAN: Array<{ origin: string; count: number; styles: string[] }> = [
  {
    origin: "Persian",
    count: 70,
    styles: ["Heriz", "Kashan", "Tabriz", "Isfahan", "Sarouk", "Sultanabad", "Serapi", "Qashqai", "Bidjar", "Malayer"],
  },
  {
    origin: "Caucasian",
    count: 30,
    styles: ["Kazak", "Shirvan", "Kuba", "Karabagh", "Dagestan"],
  },
  {
    origin: "Turkish/Anatolian",
    count: 25,
    styles: ["Oushak", "Bergama", "Kayseri", "Anatolian Kilim"],
  },
  {
    origin: "Afghan/Central Asian",
    count: 20,
    styles: ["Afghan War Rug", "Turkmen", "Bokhara", "Ersari", "Baluch"],
  },
  {
    origin: "Indian",
    count: 15,
    styles: ["Agra", "Amritsar", "Jaipur", "Lahore"],
  },
  {
    origin: "Chinese",
    count: 10,
    styles: ["Peking", "Art Deco", "Nichols"],
  },
  {
    origin: "Moroccan",
    count: 10,
    styles: ["Beni Ourain", "Berber", "Azilal"],
  },
  {
    origin: "European",
    count: 10,
    styles: ["Aubusson", "Savonnerie", "Swedish Rya"],
  },
  {
    origin: "Other/Mixed",
    count: 10,
    styles: ["Pakistani", "Tibetan", "Contemporary"],
  },
];

const SIZE_PLAN: Array<{ count: number; shape: RugRecord["shape"]; options: Array<[number, number, number, number]> }> = [
  { count: 30, shape: "area", options: [[2, 0, 3, 0], [3, 0, 5, 0], [4, 0, 6, 0]] },
  { count: 50, shape: "area", options: [[5, 0, 7, 0], [5, 0, 8, 0], [6, 0, 9, 0]] },
  { count: 80, shape: "area", options: [[8, 0, 10, 0], [8, 0, 11, 0], [9, 0, 12, 0]] },
  { count: 20, shape: "area", options: [[10, 0, 14, 0], [11, 0, 15, 0], [12, 0, 18, 0]] },
  { count: 15, shape: "runner", options: [[2, 0, 8, 0], [2, 6, 10, 0], [3, 0, 12, 0], [2, 6, 14, 0]] },
  { count: 3, shape: "round", options: [[8, 0, 8, 0], [9, 0, 9, 0], [10, 0, 10, 0]] },
  { count: 2, shape: "oval", options: [[8, 0, 10, 0], [9, 0, 12, 0]] },
];

const CONDITION_PLAN: Array<{ value: RugRecord["condition"]; count: number }> = [
  { value: "excellent", count: 80 },
  { value: "good", count: 80 },
  { value: "fair", count: 30 },
  { value: "notable_wear", count: 10 },
];

const AGE_PLAN: Array<{ value: RugRecord["age_category"]; count: number }> = [
  { value: "antique", count: 60 },
  { value: "semi-antique", count: 70 },
  { value: "vintage", count: 50 },
  { value: "new", count: 20 },
];

const COLOR_PLAN: Array<{ value: RugRecord["dominant_color"]; count: number }> = [
  { value: "blue", count: 20 },
  { value: "green", count: 15 },
  { value: "ivory", count: 12 },
  { value: "red", count: 25 },
  { value: "rust", count: 20 },
  { value: "gold", count: 18 },
  { value: "brown", count: 24 },
  { value: "multi", count: 30 },
  { value: "navy", count: 10 },
  { value: "teal", count: 10 },
  { value: "black", count: 8 },
  { value: "gray", count: 8 },
];

const WIKIMEDIA_CATEGORY_QUERIES = [
  "Category:Rugs",
  "Category:Carpets",
  "Category:Oriental_rugs",
  "Category:Persian_rugs",
  "Category:Turkish_rugs",
  "Category:Caucasian_rugs",
  "Category:Moroccan_rugs",
  "Category:Kilim",
];

const WIKIMEDIA_SEARCH_QUERIES = [
  "rug",
  "carpet",
  "oriental carpet",
  "vintage rug",
  "hand knotted rug",
  "flatweave rug",
  "Persian rug",
  "Heriz rug",
  "Kashan rug",
  "Tabriz rug",
  "Isfahan rug",
  "Sarouk rug",
  "Sultanabad rug",
  "Serapi rug",
  "Qashqai rug",
  "Bidjar rug",
  "Malayer rug",
  "Kazak rug",
  "Shirvan rug",
  "Kuba rug",
  "Karabagh rug",
  "Dagestan rug",
  "Oushak rug",
  "Bergama rug",
  "Kayseri rug",
  "Afghan rug",
  "Turkmen rug",
  "Bokhara rug",
  "Ersari rug",
  "Agra rug",
  "Amritsar rug",
  "Peking rug",
  "Beni Ourain rug",
  "Aubusson rug",
  "Savonnerie rug",
  "Swedish rya rug",
  "Tibetan rug",
];

const MET_SEARCH_QUERIES = [
  "persian rug",
  "caucasian rug",
  "turkish rug",
  "afghan rug",
  "indian rug",
  "chinese rug",
  "moroccan rug",
  "kilim rug",
  "oushak rug",
  "heriz rug",
  "tabriz rug",
  "kashan rug",
  "bokhara rug",
  "swedish rug",
  "savonnerie rug",
  "aubusson rug",
  "vintage rug",
  "antique carpet",
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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shuffle<T>(input: T[]): T[] {
  const arr = [...input];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = arr[i];
    arr[i] = arr[j] as T;
    arr[j] = temp as T;
  }
  return arr;
}

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

function expandPlan<T>(plan: Array<{ value: T; count: number }>): T[] {
  const out: T[] = [];
  for (const row of plan) {
    for (let i = 0; i < row.count; i += 1) {
      out.push(row.value);
    }
  }
  return out;
}

function buildOriginSlots() {
  const slots: Array<{ origin: string; style: string }> = [];
  for (const row of ORIGIN_PLAN) {
    for (let i = 0; i < row.count; i += 1) {
      const style = row.styles[i % row.styles.length] ?? row.styles[0] ?? "Rug";
      slots.push({ origin: row.origin, style });
    }
  }
  return shuffle(slots);
}

function buildSizeSlots() {
  const slots: Array<{ width_ft: number; width_in: number; length_ft: number; length_in: number; shape: RugRecord["shape"] }> = [];
  for (const row of SIZE_PLAN) {
    for (let i = 0; i < row.count; i += 1) {
      const option = row.options[i % row.options.length] ?? [8, 0, 10, 0];
      const [width_ft, width_in, length_ft, length_in] = option;
      slots.push({ width_ft, width_in, length_ft, length_in, shape: row.shape });
    }
  }
  return shuffle(slots);
}

async function fetchJson<T>(url: string): Promise<T | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: {
        "user-agent": "rug-concierge-live-intake/1.0",
      },
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeImageCandidateUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^https?:\/\//i.test(trimmed)) return null;
  return trimmed;
}

async function gatherWikimediaCandidates(): Promise<ImageCandidate[]> {
  const results: ImageCandidate[] = [];
  const dedupe = new Set<string>();

  async function harvestPages(payload: unknown) {
    if (!payload || typeof payload !== "object") return;
    const pages = (payload as Record<string, unknown>).query;
    if (!pages || typeof pages !== "object") return;
    const pageMap = (pages as Record<string, unknown>).pages;
    if (!pageMap || typeof pageMap !== "object") return;

    for (const row of Object.values(pageMap as Record<string, unknown>)) {
      if (!row || typeof row !== "object") continue;
      const typed = row as Record<string, unknown>;
      const title = typeof typed.title === "string" ? typed.title : "Wikimedia rug image";
      const imageinfo = Array.isArray(typed.imageinfo) ? typed.imageinfo : [];
      const first = imageinfo[0];
      if (!first || typeof first !== "object") continue;
      const info = first as Record<string, unknown>;
      const imageUrl = normalizeImageCandidateUrl(info.thumburl) ?? normalizeImageCandidateUrl(info.url);
      if (!imageUrl || dedupe.has(imageUrl)) continue;

      const pageUrl = `https://commons.wikimedia.org/wiki/${encodeURIComponent(title.replace(/\s+/g, "_"))}`;
      dedupe.add(imageUrl);
      results.push({
        source: "wikimedia",
        image_url: imageUrl,
        source_url: pageUrl,
        title,
      });
    }
  }

  for (const category of WIKIMEDIA_CATEGORY_QUERIES) {
    let cursor: string | null = null;
    for (let page = 0; page < 4; page += 1) {
      const endpoint = new URL("https://commons.wikimedia.org/w/api.php");
      endpoint.searchParams.set("action", "query");
      endpoint.searchParams.set("generator", "categorymembers");
      endpoint.searchParams.set("gcmtitle", category);
      endpoint.searchParams.set("gcmnamespace", "6");
      endpoint.searchParams.set("gcmlimit", "50");
      if (cursor) endpoint.searchParams.set("gcmcontinue", cursor);
      endpoint.searchParams.set("prop", "imageinfo");
      endpoint.searchParams.set("iiprop", "url");
      endpoint.searchParams.set("iiurlwidth", "1600");
      endpoint.searchParams.set("format", "json");

      const payload = await fetchJson<Record<string, unknown>>(endpoint.toString());
      if (!payload) break;
      await harvestPages(payload);

      const continuation = payload.continue;
      const nextCursor =
        continuation && typeof continuation === "object"
          ? (continuation as Record<string, unknown>).gcmcontinue
          : null;
      cursor = typeof nextCursor === "string" ? nextCursor : null;
      if (!cursor) break;

      await sleep(150);
    }
  }

  for (const query of WIKIMEDIA_SEARCH_QUERIES) {
    let cursor: string | null = null;
    for (let page = 0; page < 8; page += 1) {
      const endpoint = new URL("https://commons.wikimedia.org/w/api.php");
      endpoint.searchParams.set("action", "query");
      endpoint.searchParams.set("generator", "search");
      endpoint.searchParams.set("gsrnamespace", "6");
      endpoint.searchParams.set("gsrlimit", "50");
      endpoint.searchParams.set("gsrsearch", query);
      if (cursor) endpoint.searchParams.set("gsroffset", cursor);
      endpoint.searchParams.set("prop", "imageinfo");
      endpoint.searchParams.set("iiprop", "url");
      endpoint.searchParams.set("iiurlwidth", "1600");
      endpoint.searchParams.set("format", "json");

      const payload = await fetchJson<Record<string, unknown>>(endpoint.toString());
      if (!payload) break;
      await harvestPages(payload);

      const continuation = payload.continue;
      const nextOffset =
        continuation && typeof continuation === "object"
          ? (continuation as Record<string, unknown>).gsroffset
          : null;
      cursor =
        typeof nextOffset === "string"
          ? nextOffset
          : typeof nextOffset === "number" && Number.isFinite(nextOffset)
            ? String(nextOffset)
            : null;
      if (!cursor) break;
      await sleep(120);
    }
  }

  return results;
}

async function gatherMetCandidates(): Promise<ImageCandidate[]> {
  const results: ImageCandidate[] = [];
  const dedupe = new Set<string>();

  for (const query of MET_SEARCH_QUERIES) {
    const searchUrl = new URL("https://collectionapi.metmuseum.org/public/collection/v1/search");
    searchUrl.searchParams.set("hasImages", "true");
    searchUrl.searchParams.set("q", query);

    const searchPayload = await fetchJson<{ objectIDs?: number[] }>(searchUrl.toString());
    const ids = Array.isArray(searchPayload?.objectIDs)
      ? searchPayload.objectIDs.slice(0, 80)
      : [];

    for (const objectId of ids) {
      const objectUrl = `https://collectionapi.metmuseum.org/public/collection/v1/objects/${objectId}`;
      const objectPayload = await fetchJson<Record<string, unknown>>(objectUrl);
      if (!objectPayload) continue;

      const imageUrl = normalizeImageCandidateUrl(objectPayload.primaryImageSmall) ?? normalizeImageCandidateUrl(objectPayload.primaryImage);
      if (!imageUrl || dedupe.has(imageUrl)) continue;

      const title =
        typeof objectPayload.title === "string" && objectPayload.title.trim().length > 0
          ? objectPayload.title.trim()
          : `Met Object ${objectId}`;
      const sourceUrl =
        typeof objectPayload.objectURL === "string" && objectPayload.objectURL.trim().length > 0
          ? objectPayload.objectURL.trim()
          : `https://www.metmuseum.org/art/collection/search/${objectId}`;

      dedupe.add(imageUrl);
      results.push({
        source: "met",
        image_url: imageUrl,
        source_url: sourceUrl,
        title,
      });

      await sleep(40);
    }

    await sleep(80);
  }

  return results;
}

function extensionFromContentType(contentType: string): "jpg" | "png" | "webp" | null {
  const lower = contentType.toLowerCase();
  if (lower.includes("image/jpeg") || lower.includes("image/jpg")) return "jpg";
  if (lower.includes("image/png")) return "png";
  if (lower.includes("image/webp")) return "webp";
  return null;
}

async function downloadImage(input: {
  candidate: ImageCandidate;
  outputDir: string;
  sequence: number;
}): Promise<DownloadedImage | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS);

  try {
    const response = await fetch(input.candidate.image_url, {
      method: "GET",
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "user-agent": "rug-concierge-live-intake/1.0",
      },
    });

    if (!response.ok) return null;
    const contentType = response.headers.get("content-type") ?? "";
    const ext = extensionFromContentType(contentType);
    if (!ext) return null;

    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < MIN_IMAGE_BYTES || bytes.length > MAX_IMAGE_BYTES) {
      return null;
    }

    const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
    const safeTitle = input.candidate.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40);

    const filename = `${String(input.sequence).padStart(3, "0")}-${safeTitle || "rug"}.${ext}`;
    const absPath = path.join(input.outputDir, filename);
    fs.writeFileSync(absPath, bytes);

    return {
      local_path: absPath,
      source: input.candidate.source,
      source_url: input.candidate.source_url,
      source_title: input.candidate.title,
      bytes: bytes.length,
      sha256,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function buildImageSet(targetCount: number, imageDir: string): Promise<DownloadedImage[]> {
  const [wikimedia, met] = await Promise.all([gatherWikimediaCandidates(), gatherMetCandidates()]);
  console.log(
    `[dataset] Candidate pool: wikimedia=${wikimedia.length}, met=${met.length}`
  );
  const candidatePool = shuffle([...wikimedia, ...met]);

  const accepted: DownloadedImage[] = [];
  const seenHashes = new Set<string>();

  for (const candidate of candidatePool) {
    const downloaded = await downloadImage({
      candidate,
      outputDir: imageDir,
      sequence: accepted.length + 1,
    });
    if (!downloaded) continue;
    if (seenHashes.has(downloaded.sha256)) {
      fs.rmSync(downloaded.local_path, { force: true });
      continue;
    }

    seenHashes.add(downloaded.sha256);
    accepted.push(downloaded);

    if (accepted.length >= targetCount) {
      break;
    }

    await sleep(120);
  }

  console.log(
    `[dataset] Accepted unique downloadable images=${accepted.length} (target=${targetCount})`
  );

  if (accepted.length < targetCount && accepted.length > 0) {
    console.log(
      `[dataset] Generating ${targetCount - accepted.length} augmented variants from sourced images...`
    );
    const basePool = [...accepted];
    let attempts = 0;
    while (accepted.length < targetCount && attempts < targetCount * 30) {
      const base = basePool[attempts % basePool.length];
      attempts += 1;
      if (!base) break;

      const quality = String(52 + (attempts % 36));
      const width = String(980 + ((attempts * 29) % 760));
      const safeTitle = base.source_title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 34);
      const outputPath = path.join(
        imageDir,
        `${String(accepted.length + 1).padStart(3, "0")}-${safeTitle || "rug"}-v${attempts}.jpg`
      );

      try {
        execFileSync(
          "/usr/bin/sips",
          [
            "-s",
            "format",
            "jpeg",
            "-s",
            "formatOptions",
            quality,
            "--resampleWidth",
            width,
            base.local_path,
            "--out",
            outputPath,
          ],
          { stdio: "ignore" }
        );
      } catch {
        continue;
      }

      if (!fs.existsSync(outputPath)) continue;
      const bytes = fs.readFileSync(outputPath);
      if (bytes.length < MIN_IMAGE_BYTES || bytes.length > MAX_IMAGE_BYTES) {
        fs.rmSync(outputPath, { force: true });
        continue;
      }

      const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
      if (seenHashes.has(sha256)) {
        fs.rmSync(outputPath, { force: true });
        continue;
      }

      seenHashes.add(sha256);
      accepted.push({
        local_path: outputPath,
        source: base.source,
        source_url: base.source_url,
        source_title: `${base.source_title} (variant ${attempts})`,
        bytes: bytes.length,
        sha256,
      });
    }

    console.log(
      `[dataset] Total images after augmentation=${accepted.length} (target=${targetCount})`
    );
  }

  return accepted;
}

function pad3(value: number) {
  return String(value).padStart(3, "0");
}

function titleCaseAge(input: RugRecord["age_category"]) {
  if (input === "semi-antique") return "Semi-Antique";
  if (input === "new") return "New";
  return input.charAt(0).toUpperCase() + input.slice(1);
}

function buildRecords(input: {
  images: DownloadedImage[];
  count: number;
  runId: string;
}): RugRecord[] {
  const origins = buildOriginSlots();
  const sizes = buildSizeSlots();
  const conditions = shuffle(expandPlan(CONDITION_PLAN));
  const ages = shuffle(expandPlan(AGE_PLAN));
  const colors = shuffle(expandPlan(COLOR_PLAN));

  if (
    origins.length < input.count ||
    sizes.length < input.count ||
    conditions.length < input.count ||
    ages.length < input.count ||
    colors.length < input.count ||
    input.images.length < input.count
  ) {
    throw new Error("Distribution plans are insufficient for requested count.");
  }

  const records: RugRecord[] = [];
  for (let i = 0; i < input.count; i += 1) {
    const origin = origins[i] as { origin: string; style: string };
    const size = sizes[i] as { width_ft: number; width_in: number; length_ft: number; length_in: number; shape: RugRecord["shape"] };
    const condition = conditions[i] as RugRecord["condition"];
    const age = ages[i] as RugRecord["age_category"];
    const color = colors[i] as RugRecord["dominant_color"];
    const image = input.images[i] as DownloadedImage;

    const sequence = i + 1;
    const stock_id = `LIVE-${input.runId}-${pad3(sequence)}`;
    const display_name = `${titleCaseAge(age)} ${origin.origin} ${origin.style}`;

    records.push({
      sequence,
      stock_id,
      display_name,
      origin: origin.origin,
      style: origin.style,
      condition,
      age_category: age,
      dominant_color: color,
      width_ft: size.width_ft,
      width_in: size.width_in,
      length_ft: size.length_ft,
      length_in: size.length_in,
      shape: size.shape,
      image,
      expected_keywords: [
        origin.origin.toLowerCase(),
        origin.style.toLowerCase(),
        color.toLowerCase(),
      ],
    });
  }

  return records;
}

function summarize(records: RugRecord[]) {
  const byOrigin = new Map<string, number>();
  const byShape = new Map<string, number>();
  const byColor = new Map<string, number>();
  const byAge = new Map<string, number>();
  const byCondition = new Map<string, number>();

  for (const row of records) {
    byOrigin.set(row.origin, (byOrigin.get(row.origin) ?? 0) + 1);
    byShape.set(row.shape, (byShape.get(row.shape) ?? 0) + 1);
    byColor.set(row.dominant_color, (byColor.get(row.dominant_color) ?? 0) + 1);
    byAge.set(row.age_category, (byAge.get(row.age_category) ?? 0) + 1);
    byCondition.set(row.condition, (byCondition.get(row.condition) ?? 0) + 1);
  }

  return {
    total: records.length,
    by_origin: Object.fromEntries([...byOrigin.entries()].sort((a, b) => a[0].localeCompare(b[0]))),
    by_shape: Object.fromEntries([...byShape.entries()].sort((a, b) => a[0].localeCompare(b[0]))),
    by_color: Object.fromEntries([...byColor.entries()].sort((a, b) => a[0].localeCompare(b[0]))),
    by_age: Object.fromEntries([...byAge.entries()].sort((a, b) => a[0].localeCompare(b[0]))),
    by_condition: Object.fromEntries([...byCondition.entries()].sort((a, b) => a[0].localeCompare(b[0]))),
  };
}

async function main() {
  const args = parseArgs();
  const count = Number.parseInt(args.count ?? String(DEFAULT_COUNT), 10);
  if (!Number.isFinite(count) || count <= 0) {
    throw new Error("--count must be a positive integer.");
  }

  const runId = args.run_id ?? new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const outputRoot = path.resolve(args.output_dir ?? `scripts/testing/live-intake/output/${runId}`);
  const imageDir = path.join(outputRoot, "images");
  ensureDir(imageDir);

  const requestedImageTarget = Number.parseInt(
    args.image_target ?? String(count + 20),
    10
  );
  const imageTarget = Number.isFinite(requestedImageTarget) && requestedImageTarget > 0
    ? Math.max(count, requestedImageTarget)
    : count + 20;
  console.log(`[dataset] Gathering and downloading public rug images (target=${imageTarget})...`);
  const images = await buildImageSet(imageTarget, imageDir);
  if (images.length < count) {
    throw new Error(`Only sourced ${images.length} usable images; need at least ${count}.`);
  }

  const records = buildRecords({
    images,
    count,
    runId,
  });

  const summary = summarize(records);
  const datasetPath = path.join(outputRoot, "dataset.json");
  const summaryPath = path.join(outputRoot, "dataset-summary.json");

  fs.writeFileSync(datasetPath, `${JSON.stringify(records, null, 2)}\n`, "utf8");
  fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  console.log(`[dataset] Wrote ${records.length} records to ${datasetPath}`);
  console.log(`[dataset] Summary: ${summaryPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
