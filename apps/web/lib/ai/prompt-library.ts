import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import path from "node:path";

type RecommendationPromptBundle = {
  system: string;
  recommendation: string;
  recommendationStructuredOutput: string;
  generalChat: string;
};

let cachedBundle: RecommendationPromptBundle | null = null;

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

function readPromptFileOrFallback(filePath: string, fallback: string): string {
  try {
    return readFileSync(filePath, "utf8").trim() || fallback;
  } catch {
    return fallback;
  }
}

export function getRecommendationPromptBundle(): RecommendationPromptBundle {
  if (cachedBundle) return cachedBundle;

  const repoRoot = resolveRepoRootFromCwd();
  const promptsDir = path.resolve(repoRoot, "docs/prompts");

  cachedBundle = {
    system: readPromptFileOrFallback(
      path.resolve(promptsDir, "system.md"),
      "You are a rug concierge assistant. Recommend only from provided inventory. Do not invent facts."
    ),
    recommendation: readPromptFileOrFallback(
      path.resolve(promptsDir, "recommendation.md"),
      "Recommend rugs from provided inventory and explain grounded reasons."
    ),
    recommendationStructuredOutput: readPromptFileOrFallback(
      path.resolve(promptsDir, "recommendation-structured-output.md"),
      "Return only valid JSON matching the required schema."
    ),
    generalChat: readPromptFileOrFallback(
      path.resolve(promptsDir, "general-chat.md"),
      "Handle freeform rug questions clearly and practically without inventing facts."
    ),
  };

  return cachedBundle;
}
