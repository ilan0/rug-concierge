import { appendFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { IS_PRODUCTION } from "@/lib/config";

type RecommendationQaEvent = {
  request_id: string;
  tenant_id: string | null;
  user_message: string;
  constraints: unknown;
  sql_candidate_count: number;
  filtered_candidate_count: number;
  ai_candidate_count: number;
  response_mode: string;
  recommendation_ids: string[];
  notes: string | null;
  error: string | null;
  created_at: string;
};

const RECOMMENDATION_DEBUG_LOG_SEGMENTS = [
  "tmp",
  "qa",
  "recommendation-log.ndjson",
] as const;

function resolveRepoRootFromCwd(): string {
  const cwd = process.cwd();
  const candidates = [
    cwd,
    path.resolve(cwd, ".."),
    path.resolve(cwd, "..", ".."),
  ];

  for (const candidate of candidates) {
    const hasRootPackage = existsSync(path.join(candidate, "package.json"));
    const hasDocsDir = existsSync(path.join(candidate, "docs"));
    const hasAppsDir = existsSync(path.join(candidate, "apps"));
    if (hasRootPackage && hasDocsDir && hasAppsDir) {
      return candidate;
    }
  }

  for (const candidate of candidates) {
    const hasRootPackage = existsSync(path.join(candidate, "package.json"));
    const hasDocsDir = existsSync(path.join(candidate, "docs"));
    if (hasRootPackage && hasDocsDir) {
      return candidate;
    }
  }

  return cwd;
}

function getLogPath(): string {
  const repoRoot = resolveRepoRootFromCwd();
  return path.resolve(repoRoot, ...RECOMMENDATION_DEBUG_LOG_SEGMENTS);
}

function shouldWriteRecommendationQaLog(): boolean {
  return !IS_PRODUCTION;
}

export async function logRecommendationQaEvent(
  event: RecommendationQaEvent
): Promise<void> {
  if (!shouldWriteRecommendationQaLog()) return;
  try {
    const outputPath = getLogPath();
    await mkdir(path.dirname(outputPath), { recursive: true });
    await appendFile(outputPath, JSON.stringify(event) + "\n", "utf8");
  } catch (error) {
    const details =
      error instanceof Error ? error.message : "unknown logging error";
    console.error("[qa-log] Failed to append recommendation QA log:", details);
  }
}
