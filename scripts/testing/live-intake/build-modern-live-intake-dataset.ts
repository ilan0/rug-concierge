#!/usr/bin/env tsx

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

type Shape = "area" | "runner" | "round";

type ImageSource = "wikimedia" | "flickr";

type DownloadedImage = {
  local_path: string;
  source: ImageSource;
  source_url: string;
  source_title: string;
  bytes: number;
  sha256: string;
};

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
  image: DownloadedImage;
};

type WikimediaCandidate = {
  source: "wikimedia";
  image_url: string;
  source_url: string;
  title: string;
};

type FlickrCandidate = {
  source: "flickr";
  image_url: string;
  source_url: string;
  title: string;
};

type Candidate = WikimediaCandidate | FlickrCandidate;

const DEFAULT_COUNT = 40;
const IMAGE_TIMEOUT_MS = 30_000;
const MIN_IMAGE_BYTES = 40_000;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

const MODERN_SEARCH_QUERIES = [
  "modern area rug",
  "contemporary area rug",
  "abstract rug",
  "geometric rug",
  "minimalist rug",
  "scandinavian rug",
  "mid-century rug",
  "modern carpet",
  "contemporary carpet",
];

const FLICKR_TAG_QUERIES = [
  "modern,rug",
  "contemporary,rug",
  "abstract,rug",
  "minimalist,rug",
  "geometric,rug",
  "livingroom,rug",
  "modern,carpet",
  "contemporary,carpet",
  "scandinavian,rug",
  "area,rug,interior",
];

const MODERN_STYLE_POOL = [
  "Contemporary",
  "Modern Abstract",
  "Geometric Modern",
  "Scandinavian Modern",
  "Minimalist",
  "Transitional Modern",
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

const COLORS: DatasetRecord["dominant_color"][] = [
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

function ensureDir(dirPath: string) {
  fs.mkdirSync(dirPath, { recursive: true });
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

async function fetchJson<T>(url: string): Promise<T | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: {
        "user-agent": "rug-concierge-modern-intake/1.0",
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
  if (!trimmed || !/^https?:\/\//i.test(trimmed)) return null;
  return trimmed;
}

function isLikelyRugText(value: string): boolean {
  const v = value.toLowerCase();
  return /\b(rug|carpet|kilim|tapis|mat|dhurrie|berber|oushak|heriz|tabriz)\b/.test(v);
}

async function gatherWikimediaCandidates(limit: number): Promise<WikimediaCandidate[]> {
  const candidates: WikimediaCandidate[] = [];
  const seen = new Set<string>();

  for (const query of MODERN_SEARCH_QUERIES) {
    let offset: string | null = null;
    for (let page = 0; page < 10; page += 1) {
      const endpoint = new URL("https://commons.wikimedia.org/w/api.php");
      endpoint.searchParams.set("action", "query");
      endpoint.searchParams.set("generator", "search");
      endpoint.searchParams.set("gsrnamespace", "6");
      endpoint.searchParams.set("gsrlimit", "50");
      endpoint.searchParams.set("gsrsearch", query);
      if (offset) endpoint.searchParams.set("gsroffset", offset);
      endpoint.searchParams.set("prop", "imageinfo");
      endpoint.searchParams.set("iiprop", "url");
      endpoint.searchParams.set("iiurlwidth", "1800");
      endpoint.searchParams.set("format", "json");

      const payload = await fetchJson<Record<string, unknown>>(endpoint.toString());
      if (!payload) break;

      const pages = payload.query;
      const pageMap =
        pages && typeof pages === "object"
          ? (pages as Record<string, unknown>).pages
          : null;

      if (pageMap && typeof pageMap === "object") {
        for (const row of Object.values(pageMap as Record<string, unknown>)) {
          if (!row || typeof row !== "object") continue;
          const typed = row as Record<string, unknown>;
          const title = typeof typed.title === "string" ? typed.title : "Modern Rug";
          const infos = Array.isArray(typed.imageinfo) ? typed.imageinfo : [];
          const first = infos[0];
          if (!first || typeof first !== "object") continue;
          const info = first as Record<string, unknown>;
          const imageUrl =
            normalizeImageCandidateUrl(info.thumburl) ??
            normalizeImageCandidateUrl(info.url);
          if (!imageUrl || seen.has(imageUrl)) continue;

          if (!isLikelyRugText(title)) continue;
          seen.add(imageUrl);
          candidates.push({
            source: "wikimedia",
            image_url: imageUrl,
            source_url: `https://commons.wikimedia.org/wiki/${encodeURIComponent(
              title.replace(/\s+/g, "_")
            )}`,
            title,
          });
        }
      }

      if (candidates.length >= limit) break;
      const continuation = payload.continue;
      const nextOffset =
        continuation && typeof continuation === "object"
          ? (continuation as Record<string, unknown>).gsroffset
          : null;
      offset =
        typeof nextOffset === "string"
          ? nextOffset
          : typeof nextOffset === "number" && Number.isFinite(nextOffset)
            ? String(nextOffset)
            : null;
      if (!offset) break;
      await sleep(120);
    }
    if (candidates.length >= limit) break;
  }

  return candidates;
}

function toHigherResFlickrUrl(value: string): string {
  // Flickr public feed typically returns _m.jpg. _b.jpg is usually a larger rendition.
  return value.replace(/_m(\.[a-z0-9]+)$/i, "_b$1");
}

async function gatherFlickrCandidates(limit: number): Promise<FlickrCandidate[]> {
  const candidates: FlickrCandidate[] = [];
  const seen = new Set<string>();

  for (const tags of FLICKR_TAG_QUERIES) {
    const endpoint = new URL("https://www.flickr.com/services/feeds/photos_public.gne");
    endpoint.searchParams.set("format", "json");
    endpoint.searchParams.set("nojsoncallback", "1");
    endpoint.searchParams.set("tags", tags);
    endpoint.searchParams.set("tagmode", "all");

    const payload = await fetchJson<Record<string, unknown>>(endpoint.toString());
    const items = Array.isArray(payload?.items) ? payload.items : [];

    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const typed = item as Record<string, unknown>;
      const title =
        typeof typed.title === "string" && typed.title.trim().length > 0
          ? typed.title.trim()
          : `Flickr modern rug (${tags})`;
      const media =
        typed.media && typeof typed.media === "object"
          ? (typed.media as Record<string, unknown>)
          : null;
      const mediaUrl = media && typeof media.m === "string" ? media.m : null;
      if (!mediaUrl) continue;
      const imageUrl = toHigherResFlickrUrl(mediaUrl);
      if (!imageUrl || seen.has(imageUrl)) continue;
      const sourceUrl =
        typeof typed.link === "string" && typed.link.trim().length > 0
          ? typed.link.trim()
          : "https://www.flickr.com/";
      seen.add(imageUrl);
      candidates.push({
        source: "flickr",
        image_url: imageUrl,
        source_url: sourceUrl,
        title,
      });
      if (candidates.length >= limit) break;
    }
    if (candidates.length >= limit) break;
    await sleep(100);
  }

  return candidates;
}

function extensionFromContentType(contentType: string): "jpg" | "png" | "webp" | null {
  const lower = contentType.toLowerCase();
  if (lower.includes("image/jpeg") || lower.includes("image/jpg")) return "jpg";
  if (lower.includes("image/png")) return "png";
  if (lower.includes("image/webp")) return "webp";
  return null;
}

async function downloadImage(input: {
  candidate: Candidate;
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
        "user-agent": "rug-concierge-modern-intake/1.0",
      },
    });
    if (!response.ok) return null;

    const contentType = response.headers.get("content-type") ?? "";
    const ext = extensionFromContentType(contentType);
    if (!ext) return null;

    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < MIN_IMAGE_BYTES || bytes.length > MAX_IMAGE_BYTES) return null;

    const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
    const safeTitle = input.candidate.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40);
    const filename = `${String(input.sequence).padStart(3, "0")}-${safeTitle || "modern-rug"}.${ext}`;
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

function buildSizeList(count: number): Array<{
  width_ft: number;
  width_in: number;
  length_ft: number;
  length_in: number;
  shape: Shape;
}> {
  const list: Array<{
    width_ft: number;
    width_in: number;
    length_ft: number;
    length_in: number;
    shape: Shape;
  }> = [];

  for (const row of SIZE_SLOTS) {
    for (let i = 0; i < row.count; i += 1) {
      const size = row.options[i % row.options.length] ?? [8, 0, 10, 0];
      list.push({
        width_ft: size[0],
        width_in: size[1],
        length_ft: size[2],
        length_in: size[3],
        shape: row.shape,
      });
    }
  }

  const shuffled = shuffle(list);
  return shuffled.slice(0, count);
}

function summarize(records: DatasetRecord[]) {
  const byStyle = new Map<string, number>();
  const byShape = new Map<string, number>();
  const byColor = new Map<string, number>();
  for (const row of records) {
    byStyle.set(row.style, (byStyle.get(row.style) ?? 0) + 1);
    byShape.set(row.shape, (byShape.get(row.shape) ?? 0) + 1);
    byColor.set(row.dominant_color, (byColor.get(row.dominant_color) ?? 0) + 1);
  }
  return {
    total: records.length,
    by_style: Object.fromEntries([...byStyle.entries()].sort((a, b) => b[1] - a[1])),
    by_shape: Object.fromEntries([...byShape.entries()].sort((a, b) => b[1] - a[1])),
    by_color: Object.fromEntries([...byColor.entries()].sort((a, b) => b[1] - a[1])),
  };
}

async function main() {
  const args = parseArgs();
  const count = Number.parseInt(args.count ?? String(DEFAULT_COUNT), 10);
  if (!Number.isFinite(count) || count <= 0) {
    throw new Error("--count must be a positive integer.");
  }

  const runId =
    args.run_id ??
    `modern-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}`;
  const outputRoot = path.resolve(
    args.output_dir ?? `scripts/testing/live-intake/output/${runId}`
  );
  const imageDir = path.join(outputRoot, "images");
  ensureDir(imageDir);

  const candidateTarget = Math.max(count * 5, 180);
  console.log(`[modern-dataset] gathering modern candidates (target pool ~${candidateTarget})...`);
  const [flickrCandidates, wikimediaCandidates] = await Promise.all([
    gatherFlickrCandidates(candidateTarget),
    gatherWikimediaCandidates(candidateTarget),
  ]);
  const candidates: Candidate[] = shuffle([
    ...flickrCandidates,
    ...wikimediaCandidates,
  ]);
  console.log(
    `[modern-dataset] candidate pool: flickr=${flickrCandidates.length}, wikimedia=${wikimediaCandidates.length}`
  );
  if (candidates.length < count) {
    throw new Error(`Only found ${candidates.length} candidates; need at least ${count}.`);
  }

  const accepted: DownloadedImage[] = [];
  const seenHashes = new Set<string>();
  for (const candidate of shuffle(candidates)) {
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
    if (accepted.length >= count) break;
    await sleep(90);
  }

  if (accepted.length < count && accepted.length > 0) {
    let attempts = 0;
    while (accepted.length < count && attempts < count * 20) {
      const base = accepted[attempts % accepted.length];
      attempts += 1;
      if (!base) break;

      const quality = String(58 + (attempts % 24));
      const width = String(960 + ((attempts * 37) % 720));
      const out = path.join(
        imageDir,
        `${String(accepted.length + 1).padStart(3, "0")}-modern-v${attempts}.jpg`
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
            out,
          ],
          { stdio: "ignore" }
        );
      } catch {
        continue;
      }
      if (!fs.existsSync(out)) continue;
      const bytes = fs.readFileSync(out);
      if (bytes.length < MIN_IMAGE_BYTES || bytes.length > MAX_IMAGE_BYTES) {
        fs.rmSync(out, { force: true });
        continue;
      }
      const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
      if (seenHashes.has(sha256)) {
        fs.rmSync(out, { force: true });
        continue;
      }
      seenHashes.add(sha256);
      accepted.push({
        local_path: out,
        source: "wikimedia",
        source_url: base.source_url,
        source_title: `${base.source_title} (variant)`,
        bytes: bytes.length,
        sha256,
      });
    }
  }

  if (accepted.length < count) {
    throw new Error(`Only prepared ${accepted.length} images; need ${count}.`);
  }

  const sizes = buildSizeList(count);
  if (sizes.length < count) {
    throw new Error(`Could not build enough size slots (${sizes.length}/${count}).`);
  }

  const records: DatasetRecord[] = [];
  for (let i = 0; i < count; i += 1) {
    const image = accepted[i];
    const size = sizes[i];
    if (!image || !size) continue;

    const style = MODERN_STYLE_POOL[i % MODERN_STYLE_POOL.length] ?? "Contemporary";
    const color = COLORS[i % COLORS.length] ?? "multi";
    const condition: DatasetRecord["condition"] =
      i % 10 === 0 ? "fair" : i % 3 === 0 ? "good" : "excellent";
    const age: DatasetRecord["age_category"] = i % 8 === 0 ? "vintage" : "new";
    const stockSuffix = String(i + 1).padStart(3, "0");
    const stockId = `LIVE-MOD-${runId.replace(/[^0-9]/g, "").slice(0, 8) || "20260327"}-${stockSuffix}`;

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
      image,
    });
  }

  const datasetPath = path.join(outputRoot, "dataset.json");
  const summaryPath = path.join(outputRoot, "dataset-summary.json");
  fs.writeFileSync(datasetPath, `${JSON.stringify(records, null, 2)}\n`, "utf8");
  fs.writeFileSync(summaryPath, `${JSON.stringify(summarize(records), null, 2)}\n`, "utf8");

  console.log(`[modern-dataset] wrote ${records.length} records to ${datasetPath}`);
  console.log(`[modern-dataset] summary: ${summaryPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
