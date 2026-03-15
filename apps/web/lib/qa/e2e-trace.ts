import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

export type E2eTraceMeta = {
  run_id: string;
  case_id: string;
};

export type E2eTraceWriteInput = {
  meta: E2eTraceMeta;
  channel: string;
  trace_id: string;
  payload: unknown;
};

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

function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function getArtifactPath(meta: E2eTraceMeta, channel: string, traceId: string): string {
  const repoRoot = resolveRepoRootFromCwd();
  const runId = slug(meta.run_id);
  const caseId = slug(meta.case_id);
  const channelSlug = slug(channel || "trace");
  return path.resolve(
    repoRoot,
    "docs/testing/artifacts",
    runId,
    caseId,
    `${channelSlug}-${slug(traceId)}.json`
  );
}

function isE2eTraceEnabled(): boolean {
  const override = process.env.ENABLE_E2E_TRACE_ARTIFACTS;
  if (override === "1") return true;
  if (override === "0") return false;
  if (process.env.QA_MODE === "1") return true;
  return process.env.NODE_ENV !== "production";
}

export function parseE2eTraceMeta(req: Request): E2eTraceMeta | null {
  if (!isE2eTraceEnabled()) return null;
  const runId = req.headers.get("x-e2e-trace-run")?.trim();
  const caseId = req.headers.get("x-e2e-trace-case")?.trim();
  if (!runId || !caseId) return null;
  return {
    run_id: runId,
    case_id: caseId,
  };
}

export async function writeE2eTraceArtifact(
  input: E2eTraceWriteInput
): Promise<string | null> {
  if (!isE2eTraceEnabled()) return null;
  try {
    const filePath = getArtifactPath(input.meta, input.channel, input.trace_id);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(
      filePath,
      JSON.stringify(
        {
          trace_id: input.trace_id,
          channel: input.channel,
          created_at: new Date().toISOString(),
          payload: input.payload,
        },
        null,
        2
      ),
      "utf8"
    );
    return filePath;
  } catch {
    return null;
  }
}
