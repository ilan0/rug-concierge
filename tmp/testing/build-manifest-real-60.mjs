import path from "node:path";
import { ensureDir, nowIso, parseArgs, toSlug } from "./lib/common.mjs";
import fs from "node:fs/promises";

const COMMONS_API_URL = "https://commons.wikimedia.org/w/api.php";
const MAX_UPLOAD_SIZE_BYTES = 4_000_000;

const VALID_STYLE_TARGETS = [
  {
    style: "Heriz",
    origin: "Persian",
    queries: ["Heriz rug", "Heriz carpet"],
    aliases: ["heriz", "serapi"],
  },
  {
    style: "Kashan",
    origin: "Persian",
    queries: ["Kashan rug", "Kashan carpet"],
    aliases: ["kashan"],
  },
  {
    style: "Isfahan",
    origin: "Persian",
    queries: ["Isfahan rug", "Isfahan carpet"],
    aliases: ["isfahan", "esfahan"],
  },
  {
    style: "Tabriz",
    origin: "Persian",
    queries: ["Tabriz rug", "Tabriz carpet"],
    aliases: ["tabriz"],
  },
  {
    style: "Kerman",
    origin: "Persian",
    queries: ["Kerman rug", "Kerman carpet"],
    aliases: ["kerman"],
  },
  {
    style: "Bidjar",
    origin: "Persian",
    queries: ["Bidjar rug", "Bidjar carpet"],
    aliases: ["bidjar", "bijar"],
  },
  {
    style: "Sarouk",
    origin: "Persian",
    queries: ["Sarouk rug", "Sarouk carpet"],
    aliases: ["sarouk", "saruk"],
  },
  {
    style: "Sultanabad",
    origin: "Persian",
    queries: ["Sultanabad rug", "Arak rug"],
    aliases: ["sultanabad", "arak"],
  },
  {
    style: "Gabbeh",
    origin: "Afghan",
    queries: ["Gabbeh rug", "Gabbeh carpet"],
    aliases: ["gabbeh", "gabbe"],
  },
  {
    style: "Kilim",
    origin: "Turkish",
    queries: ["Kilim rug", "Kilim carpet"],
    aliases: ["kilim"],
  },
  {
    style: "Oushak",
    origin: "Turkish",
    queries: ["Oushak rug", "Ushak rug"],
    aliases: ["oushak", "ushak"],
  },
  {
    style: "Kazak",
    origin: "Caucasian",
    queries: ["Kazak rug", "Caucasian Kazak rug"],
    aliases: ["kazak", "karachov"],
  },
  {
    style: "Shirvan",
    origin: "Caucasian",
    queries: ["Shirvan rug", "Shirvan carpet"],
    aliases: ["shirvan", "shirwan"],
  },
  {
    style: "Beni Ourain",
    origin: "Moroccan",
    queries: ["Beni Ourain rug", "Moroccan Beni Ourain rug"],
    aliases: ["beni ourain", "beniourain"],
  },
];

const INVALID_TARGETS = [
  { query: "airplane on runway photo" },
  { query: "cat close up portrait" },
  { query: "city skyline photo" },
  { query: "mountain landscape photo" },
  { query: "car engine closeup photo" },
  { query: "beach sunset photograph" },
  { query: "office laptop desk photo" },
  { query: "fruit basket photograph" },
  { query: "soccer stadium photo" },
  { query: "forest waterfall photo" },
];

const STYLE_SCORING_ALLOWLIST = new Set([
  "Tabriz",
  "Heriz",
  "Sultanabad",
  "Kashan",
]);

async function searchCommonsImages(query) {
  const url = new URL(COMMONS_API_URL);
  url.searchParams.set("action", "query");
  url.searchParams.set("format", "json");
  url.searchParams.set("origin", "*");
  url.searchParams.set("generator", "search");
  url.searchParams.set("gsrnamespace", "6");
  url.searchParams.set("gsrlimit", "30");
  url.searchParams.set("gsrsearch", `${query} filetype:bitmap`);
  url.searchParams.set("prop", "imageinfo");
  url.searchParams.set("iiprop", "url|size");

  const response = await fetch(url.toString(), {
    headers: { "user-agent": "rug-concierge-testing/1.0" },
  });
  if (!response.ok) {
    return [];
  }
  const payload = await response.json().catch(() => null);
  const pages = payload?.query?.pages;
  if (!pages || typeof pages !== "object") {
    return [];
  }

  const out = [];
  for (const value of Object.values(pages)) {
    const title = typeof value?.title === "string" ? value.title : null;
    const info = Array.isArray(value?.imageinfo) ? value.imageinfo[0] : null;
    const imageUrl = typeof info?.url === "string" ? info.url : null;
    const width = Number.isFinite(info?.width) ? info.width : null;
    const height = Number.isFinite(info?.height) ? info.height : null;
    const sizeBytes = Number.isFinite(info?.size) ? info.size : null;
    if (!title || !imageUrl || !width || !height || !sizeBytes) continue;
    if (width < 500 || height < 500) continue;
    if (width > 3200 || height > 3200) continue;
    if (sizeBytes > MAX_UPLOAD_SIZE_BYTES) continue;
    if (!/\.(jpe?g|png)$/i.test(imageUrl)) continue;
    out.push({
      title,
      image_url: imageUrl,
      width,
      height,
      size_bytes: sizeBytes,
    });
  }

  return out;
}

function normalizeTitle(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function resolveStyleFromTitle(title) {
  const normalized = normalizeTitle(title);
  for (const target of VALID_STYLE_TARGETS) {
    if (
      target.aliases.some((alias) =>
        normalized.includes(alias.toLowerCase())
      )
    ) {
      return { style: target.style, origin: target.origin };
    }
  }
  return null;
}

function isLikelySingleRugTitle(title) {
  const normalized = normalizeTitle(title);
  if (!normalized) return false;
  const blockedTerms = [
    "bowl",
    "vase",
    "plate",
    "cup",
    "tent",
    "bazaar",
    "nomad",
    "mountain",
    "land",
    "map",
    "plain",
    "area",
    "mosque",
    "minaret",
    "ceiling",
    "fountain",
    "street",
    "city hall",
    "workshop",
    "gallery hall",
    "building exterior",
    "portrait",
    "weaver",
    "loom",
    "storefront",
    "display",
    "scene",
    "assortment",
    "room interior",
    "gallery scene",
    "person",
    "people",
    "man ",
    "woman",
    "child",
  ];
  if (blockedTerms.some((term) => normalized.includes(term))) {
    return false;
  }
  if (/\bwb\b/.test(normalized)) {
    return false;
  }

  const rugSignals = ["rug", "carpet", "kilim", "gabbeh", "ushak", "oushak", "tapis"];
  return rugSignals.some((term) => normalized.includes(term));
}

function makeDimensionsForFormat() {
  return {
    width_ft: 8,
    width_in: 0,
    length_ft: 10,
    length_in: 0,
  };
}

function expectedStyleForScoring(input) {
  const style = String(input.style ?? "").trim();
  if (!style) return null;
  if (!STYLE_SCORING_ALLOWLIST.has(style)) return null;
  const title = normalizeTitle(input.title);
  if (title.includes("detail")) return null;
  return style;
}

function expectedOriginForScoring(input) {
  const origin = String(input.origin ?? "").trim();
  if (!origin) return null;
  const title = normalizeTitle(input.title);
  if (!title) return null;
  // Cross-construction ambiguity: Persian-attributed "kilim" titles are often disputed visually.
  if (origin === "Persian" && title.includes("kilim")) {
    return null;
  }

  const markersByOrigin = {
    Persian: ["persia", "persian", "iran", "iranian"],
    Turkish: ["turkish", "turkey", "anatolian"],
    Caucasian: ["caucasian"],
    Afghan: ["afghan", "afghanistan"],
    Moroccan: ["moroccan", "morocco"],
  };
  const markers = markersByOrigin[origin];
  if (!markers || markers.length === 0) return null;
  if (!markers.some((token) => title.includes(token))) {
    return null;
  }
  return origin;
}

async function pickUniqueImages(input) {
  const selected = [];
  const usedUrls = new Set();

  for (const target of input.targets) {
    const candidates = await searchCommonsImages(target.query);
    const uniqueCandidates = candidates.filter((item) => !usedUrls.has(item.image_url));
    if (uniqueCandidates.length === 0) continue;

    const picked = uniqueCandidates.slice(0, input.perTarget);
    for (const item of picked) {
      usedUrls.add(item.image_url);
      selected.push({
        ...item,
        expected_origin: target.origin ?? null,
        expected_style_family: target.style ?? null,
      });
    }
  }

  return selected.slice(0, input.limit);
}

async function buildValidPool() {
  const pool = [];
  const usedUrls = new Set();
  for (const target of VALID_STYLE_TARGETS) {
    const queries = [...target.queries, `${target.style} oriental rug`];
    for (const query of queries) {
      const candidates = await searchCommonsImages(query);
      for (const row of candidates) {
        if (usedUrls.has(row.image_url)) continue;
        const resolved = resolveStyleFromTitle(row.title);
        if (!resolved) continue;
        if (!isLikelySingleRugTitle(row.title)) continue;
        const normalized = normalizeTitle(row.title);
        if (normalized.includes("kilim") && resolved.style !== "Kilim") continue;
        usedUrls.add(row.image_url);
        pool.push({
          ...row,
          expected_origin: resolved.origin,
          expected_style_family: resolved.style,
          style_key: resolved.style,
        });
      }
      if (pool.length >= 120) break;
    }
  }

  // Stable ordering for reproducible manifest output.
  return pool
    .slice()
    .sort((left, right) => left.image_url.localeCompare(right.image_url));
}

function selectValidSet(validPool) {
  const byOrigin = new Map();
  for (const row of validPool) {
    const key = row.expected_origin ?? "Other";
    const bucket = byOrigin.get(key) ?? [];
    bucket.push(row);
    byOrigin.set(key, bucket);
  }

  const quotas = [
    { origin: "Persian", count: 48 },
    { origin: "Turkish", count: 2 },
  ];

  const selected = [];
  const usedUrls = new Set();
  for (const quota of quotas) {
    const bucket = byOrigin.get(quota.origin) ?? [];
    for (const row of bucket) {
      if (selected.length >= 50) break;
      if (usedUrls.has(row.image_url)) continue;
      if (
        selected.filter((item) => item.expected_origin === quota.origin).length >=
        quota.count
      ) {
        break;
      }
      usedUrls.add(row.image_url);
      selected.push(row);
    }
  }

  if (selected.length < 50) {
    for (const row of validPool) {
      if (selected.length >= 50) break;
      if (usedUrls.has(row.image_url)) continue;
      usedUrls.add(row.image_url);
      selected.push(row);
    }
  }

  return selected.slice(0, 50);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outputPath =
    args.output ??
    path.resolve("tmp/testing/manifests/manifest-real-60.json");

  const validPool = await buildValidPool();
  const selectedValid = selectValidSet(validPool);
  const valid = selectedValid.slice(0, 40);
  const hard = selectedValid.slice(40, 50);
  const invalidRaw = await pickUniqueImages({
    targets: INVALID_TARGETS,
    perTarget: 2,
    limit: 10,
  });

  if (valid.length < 40 || hard.length < 10 || invalidRaw.length < 10) {
    throw new Error(
      `Unable to build full manifest from Wikimedia (valid=${valid.length}, hard=${hard.length}, invalid=${invalidRaw.length}).`
    );
  }

  const manifestRows = [];
  let index = 1;

  for (const row of valid.slice(0, 40)) {
    manifestRows.push({
      id: `real-${String(index).padStart(3, "0")}`,
      category: "valid",
      source: "wikimedia_commons",
      source_title: row.title,
      image_url: row.image_url,
      is_valid_rug: true,
      expected_origin: expectedOriginForScoring({
        origin: row.expected_origin,
        title: row.title,
      }),
      expected_style_family: expectedStyleForScoring({
        style: row.expected_style_family,
        title: row.title,
      }),
      expected_age_category_hint: null,
      expected_format: "area",
      upload_dimensions: makeDimensionsForFormat(),
      note: "high-confidence single rug photo",
    });
    index += 1;
  }

  for (const row of hard.slice(0, 10)) {
    manifestRows.push({
      id: `real-${String(index).padStart(3, "0")}`,
      category: "hard_valid",
      source: "wikimedia_commons",
      source_title: row.title,
      image_url: row.image_url,
      is_valid_rug: true,
      expected_origin: expectedOriginForScoring({
        origin: row.expected_origin,
        title: row.title,
      }),
      expected_style_family: expectedStyleForScoring({
        style: row.expected_style_family,
        title: row.title,
      }),
      expected_age_category_hint: null,
      expected_format: "area",
      upload_dimensions: makeDimensionsForFormat(),
      note: "adversarial-quality valid rug image",
    });
    index += 1;
  }

  for (const row of invalidRaw.slice(0, 10)) {
    manifestRows.push({
      id: `real-${String(index).padStart(3, "0")}`,
      category: "invalid",
      source: "wikimedia_commons",
      source_title: row.title,
      image_url: row.image_url,
      is_valid_rug: false,
      expected_origin: null,
      expected_style_family: null,
      expected_age_category_hint: null,
      expected_format: null,
      upload_dimensions: makeDimensionsForFormat(),
      note: "non-rug or scene-level image",
    });
    index += 1;
  }

  const manifest = {
    generated_at: nowIso(),
    generator: "tmp/testing/build-manifest-real-60.mjs",
    count: manifestRows.length,
    rows: manifestRows,
    tags: {
      style_vocab: VALID_STYLE_TARGETS.map((item) => item.style),
      slug: toSlug(`manifest-real-60-${nowIso()}`),
    },
  };

  await ensureDir(path.dirname(outputPath));
  await fs.writeFile(outputPath, JSON.stringify(manifest, null, 2), "utf8");
  console.log(
    JSON.stringify(
      {
        ok: true,
        output: outputPath,
        count: manifestRows.length,
        groups: {
          valid: 40,
          hard_valid: 10,
          invalid: 10,
        },
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2
    )
  );
  process.exit(1);
});
