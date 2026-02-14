import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

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

function getLogPath(): string {
  const configured = process.env.RECOMMENDATION_QA_LOG_PATH;
  if (configured && configured.trim()) {
    return path.resolve(configured);
  }

  return path.resolve(process.cwd(), "docs/testing/qa-log.ndjson");
}

export async function logRecommendationQaEvent(
  event: RecommendationQaEvent
): Promise<void> {
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

