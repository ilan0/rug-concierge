#!/usr/bin/env tsx

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { CANONICAL_COLORS } from "../../apps/web/lib/config/color-taxonomy";

type ScriptOptions = {
  tenantId: string;
  outputDir: string;
};

type RugRow = {
  id: string;
  status: string | null;
  enrichment_status: string | null;
  ai_structured_fields: Record<string, unknown> | null;
  staff_overrides: Record<string, unknown> | null;
};

type TokenStats = {
  token: string;
  count: number;
  rug_ids: string[];
};

const DEFAULT_OUTPUT_DIR = "tmp/qa/color-audit";
const PAGE_SIZE = 1000;

const KNOWN_CANONICAL = new Set(CANONICAL_COLORS);

const SUGGESTION_RULES: Array<{ canonical: string; patterns: RegExp[] }> = [
  {
    canonical: "blue",
    patterns: [
      /\bblue\b/i,
      /\bnavy\b/i,
      /\bindigo\b/i,
      /\bcobalt\b/i,
      /\bdenim\b/i,
      /\bmidnight\b/i,
    ],
  },
  {
    canonical: "teal",
    patterns: [/\bteal\b/i, /\bturquoise\b/i, /\baqua\b/i],
  },
  {
    canonical: "green",
    patterns: [
      /\bgreen\b/i,
      /\bolive\b/i,
      /\bsage\b/i,
      /\bemerald\b/i,
      /\bmint\b/i,
      /\bhunter\b/i,
      /\bforest\b/i,
    ],
  },
  {
    canonical: "purple",
    patterns: [
      /\bpurple\b/i,
      /\bviolet\b/i,
      /\bplum\b/i,
      /\blavender\b/i,
      /\blilac\b/i,
    ],
  },
  {
    canonical: "red",
    patterns: [
      /\bred\b/i,
      /\bburgundy\b/i,
      /\bmaroon\b/i,
      /\bcrimson\b/i,
      /\bwine\b/i,
    ],
  },
  {
    canonical: "rust",
    patterns: [/\brust\b/i, /\bterracotta\b/i, /\bbrick\b/i, /\borange\b/i, /\bcopper\b/i],
  },
  {
    canonical: "gold",
    patterns: [/\bgold\b/i, /\byellow\b/i, /\bmustard\b/i, /\bochre\b/i, /\bamber\b/i],
  },
  {
    canonical: "pink",
    patterns: [
      /\bpink\b/i,
      /\bcoral\b/i,
      /\bsalmon\b/i,
      /\bblush\b/i,
      /\brose\b/i,
      /\bpeach\b/i,
    ],
  },
  {
    canonical: "ivory",
    patterns: [
      /\bivory\b/i,
      /\boff[\s-]?white\b/i,
      /\bbone\b/i,
      /\blinen\b/i,
      /\bcream\b/i,
      /\bbeige\b/i,
      /\btan\b/i,
      /\btaupe\b/i,
      /\bsand\b/i,
      /\bcamel\b/i,
    ],
  },
  {
    canonical: "brown",
    patterns: [/\bbrown\b/i, /\bchocolate\b/i, /\bwalnut\b/i, /\bmocha\b/i],
  },
  {
    canonical: "gray",
    patterns: [/\bgray\b/i, /\bgrey\b/i, /\bcharcoal\b/i, /\bslate\b/i, /\bsteel\b/i],
  },
  {
    canonical: "white",
    patterns: [/\bwhite\b/i],
  },
  {
    canonical: "black",
    patterns: [/\bblack\b/i],
  },
  {
    canonical: "multi",
    patterns: [/\bmulticolor\b/i, /\bmulti[\s-]?color\b/i, /\bvariegated\b/i],
  },
];

function loadEnvFileIfExists(filePath: string): void {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
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

function loadEnv(): void {
  const root = process.cwd();
  loadEnvFileIfExists(path.resolve(root, ".env.local"));
  loadEnvFileIfExists(path.resolve(root, "apps/web/.env.local"));
}

function readTrimmedEnv(name: string): string | null {
  const raw = process.env[name];
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  return value.length > 0 ? value : null;
}

function assertEnv(name: string): string {
  const value = readTrimmedEnv(name);
  if (!value) {
    throw new Error(`Missing ${name} environment variable.`);
  }
  return value;
}

function parseArgs(argv: string[]): ScriptOptions {
  let tenantId = readTrimmedEnv("TENANT_ID") ?? "";
  let outputDir = DEFAULT_OUTPUT_DIR;

  for (const arg of argv) {
    if (arg.startsWith("--tenant-id=")) {
      tenantId = arg.slice("--tenant-id=".length).trim();
      continue;
    }
    if (arg.startsWith("--output-dir=")) {
      outputDir = arg.slice("--output-dir=".length).trim();
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!tenantId) {
    throw new Error("Missing --tenant-id=<tenant_id> (or TENANT_ID env var).");
  }
  if (!outputDir) {
    throw new Error("Missing output directory.");
  }

  return {
    tenantId,
    outputDir,
  };
}

function normalizeToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toStringArray(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((entry) => (typeof entry === "string" ? normalizeToken(entry) : ""))
    .filter((entry) => entry.length > 0);
}

function extractColors(record: Record<string, unknown> | null): string[] {
  if (!record) return [];
  return toStringArray(record.primary_colors);
}

function isActive(row: RugRow): boolean {
  return row.status === "available" && row.enrichment_status === "ready";
}

function addToken(
  map: Map<string, { count: number; rugIds: Set<string> }>,
  token: string,
  rugId: string
): void {
  const existing = map.get(token);
  if (!existing) {
    map.set(token, {
      count: 1,
      rugIds: new Set([rugId]),
    });
    return;
  }
  existing.count += 1;
  existing.rugIds.add(rugId);
}

function mapToSortedStats(
  input: Map<string, { count: number; rugIds: Set<string> }>
): TokenStats[] {
  const out: TokenStats[] = [];
  for (const [token, value] of input.entries()) {
    out.push({
      token,
      count: value.count,
      rug_ids: [...value.rugIds].slice(0, 8),
    });
  }
  out.sort((left, right) => {
    if (right.count !== left.count) return right.count - left.count;
    return left.token.localeCompare(right.token);
  });
  return out;
}

function suggestCanonical(token: string): string | null {
  if (KNOWN_CANONICAL.has(token)) return token;
  for (const rule of SUGGESTION_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(token))) {
      return rule.canonical;
    }
  }
  return null;
}

async function fetchAllRugs(input: {
  supabaseUrl: string;
  supabaseKey: string;
  tenantId: string;
}): Promise<RugRow[]> {
  const supabase = createClient(input.supabaseUrl, input.supabaseKey, {
    auth: { persistSession: false },
  });

  const rows: RugRow[] = [];
  let page = 0;

  while (true) {
    const start = page * PAGE_SIZE;
    const end = start + PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from("rugs")
      .select("id, status, enrichment_status, ai_structured_fields, staff_overrides")
      .eq("tenant_id", input.tenantId)
      .range(start, end);

    if (error) {
      throw new Error(`Failed to query rugs: ${error.message}`);
    }
    if (!Array.isArray(data) || data.length === 0) break;

    for (const row of data) {
      if (!row || typeof row !== "object") continue;
      const record = row as Record<string, unknown>;
      if (typeof record.id !== "string" || record.id.trim().length === 0) continue;
      rows.push({
        id: record.id,
        status: typeof record.status === "string" ? record.status : null,
        enrichment_status:
          typeof record.enrichment_status === "string"
            ? record.enrichment_status
            : null,
        ai_structured_fields:
          record.ai_structured_fields &&
          typeof record.ai_structured_fields === "object"
            ? (record.ai_structured_fields as Record<string, unknown>)
            : null,
        staff_overrides:
          record.staff_overrides && typeof record.staff_overrides === "object"
            ? (record.staff_overrides as Record<string, unknown>)
            : null,
      });
    }

    if (data.length < PAGE_SIZE) break;
    page += 1;
  }

  return rows;
}

function buildReport(rows: RugRow[], tenantId: string) {
  const all = rows;
  const active = rows.filter(isActive);

  const allAi = new Map<string, { count: number; rugIds: Set<string> }>();
  const allStaff = new Map<string, { count: number; rugIds: Set<string> }>();
  const allEffective = new Map<string, { count: number; rugIds: Set<string> }>();

  const activeAi = new Map<string, { count: number; rugIds: Set<string> }>();
  const activeStaff = new Map<string, { count: number; rugIds: Set<string> }>();
  const activeEffective = new Map<string, { count: number; rugIds: Set<string> }>();

  for (const row of all) {
    const aiColors = extractColors(row.ai_structured_fields);
    const staffColors = extractColors(row.staff_overrides);
    const effectiveColors = staffColors.length > 0 ? staffColors : aiColors;

    for (const token of aiColors) addToken(allAi, token, row.id);
    for (const token of staffColors) addToken(allStaff, token, row.id);
    for (const token of effectiveColors) addToken(allEffective, token, row.id);
  }

  for (const row of active) {
    const aiColors = extractColors(row.ai_structured_fields);
    const staffColors = extractColors(row.staff_overrides);
    const effectiveColors = staffColors.length > 0 ? staffColors : aiColors;

    for (const token of aiColors) addToken(activeAi, token, row.id);
    for (const token of staffColors) addToken(activeStaff, token, row.id);
    for (const token of effectiveColors) addToken(activeEffective, token, row.id);
  }

  const activeEffectiveStats = mapToSortedStats(activeEffective);
  const unknownActiveTokens = activeEffectiveStats
    .filter((entry) => !KNOWN_CANONICAL.has(entry.token))
    .map((entry) => ({
      token: entry.token,
      count: entry.count,
      rug_ids: entry.rug_ids,
      proposed_canonical: suggestCanonical(entry.token),
    }));

  return {
    generated_at: new Date().toISOString(),
    tenant_id: tenantId,
    inventory_summary: {
      rugs_total: all.length,
      rugs_active_ready: active.length,
    },
    token_stats: {
      all: {
        ai_structured_fields: mapToSortedStats(allAi),
        staff_overrides: mapToSortedStats(allStaff),
        effective: mapToSortedStats(allEffective),
      },
      active_ready: {
        ai_structured_fields: mapToSortedStats(activeAi),
        staff_overrides: mapToSortedStats(activeStaff),
        effective: activeEffectiveStats,
      },
    },
    unknown_active_effective_tokens: unknownActiveTokens,
    known_canonical_tokens_snapshot: [...KNOWN_CANONICAL].sort(),
  };
}

function formatMarkdownReport(input: ReturnType<typeof buildReport>): string {
  const lines: string[] = [];
  lines.push("# Color Audit Report");
  lines.push("");
  lines.push(`- Generated: ${input.generated_at}`);
  lines.push(`- Tenant: ${input.tenant_id}`);
  lines.push(`- Rugs total: ${input.inventory_summary.rugs_total}`);
  lines.push(`- Rugs active+ready: ${input.inventory_summary.rugs_active_ready}`);
  lines.push("");

  lines.push("## Top Effective Tokens (Active + Ready)");
  lines.push("");
  lines.push("| token | count | sample_rug_ids |");
  lines.push("| --- | ---: | --- |");
  for (const entry of input.token_stats.active_ready.effective.slice(0, 40)) {
    lines.push(`| ${entry.token} | ${entry.count} | ${entry.rug_ids.join(", ")} |`);
  }
  lines.push("");

  lines.push("## Unknown Active Effective Tokens");
  lines.push("");
  lines.push("| token | count | proposed_canonical | sample_rug_ids |");
  lines.push("| --- | ---: | --- | --- |");
  for (const entry of input.unknown_active_effective_tokens) {
    lines.push(
      `| ${entry.token} | ${entry.count} | ${entry.proposed_canonical ?? "(none)"} | ${entry.rug_ids.join(", ")} |`
    );
  }
  if (input.unknown_active_effective_tokens.length === 0) {
    lines.push("| (none) | 0 | - | - |");
  }
  lines.push("");

  return `${lines.join("\n")}\n`;
}

async function main() {
  loadEnv();
  const options = parseArgs(process.argv.slice(2));
  const supabaseUrl = assertEnv("SUPABASE_URL");
  const supabaseKey = assertEnv("SUPABASE_SECRET_KEY");

  const rows = await fetchAllRugs({
    supabaseUrl,
    supabaseKey,
    tenantId: options.tenantId,
  });
  const report = buildReport(rows, options.tenantId);

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = path.resolve(process.cwd(), options.outputDir);
  fs.mkdirSync(outDir, { recursive: true });

  const jsonPath = path.resolve(outDir, `${timestamp}.json`);
  const markdownPath = path.resolve(outDir, `${timestamp}.md`);

  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(markdownPath, formatMarkdownReport(report));

  console.log(
    JSON.stringify(
      {
        ok: true,
        tenant_id: options.tenantId,
        rugs_total: report.inventory_summary.rugs_total,
        rugs_active_ready: report.inventory_summary.rugs_active_ready,
        unknown_active_effective_tokens: report.unknown_active_effective_tokens.length,
        report_json: path.relative(process.cwd(), jsonPath),
        report_md: path.relative(process.cwd(), markdownPath),
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
