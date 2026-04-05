import { NextResponse } from "next/server";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { parseSearchParamsWithSchema } from "@/lib/http/route-validation";

const IS_PRODUCTION = process.env.NODE_ENV === "production";

const DEBUG_TRACE_QUERY_SCHEMA = z
  .object({
    run: z.string().trim().min(1),
    case: z.string().trim().min(1),
  })
  .strict();

function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

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

  return cwd;
}

export async function GET(req: Request) {
  if (IS_PRODUCTION) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const url = new URL(req.url);
  const parsedQuery = parseSearchParamsWithSchema(
    url.searchParams,
    DEBUG_TRACE_QUERY_SCHEMA,
    "run and case are required query params."
  );
  if (!parsedQuery.ok) return parsedQuery.response;
  const run = parsedQuery.value.run;
  const testCase = parsedQuery.value.case;

  // Tenant enforcement is intentionally skipped for this route.
  // This endpoint is developer-only and reads local debug artifact files,
  // not tenant-scoped production data from Supabase.
  const repoRoot = resolveRepoRootFromCwd();
  const traceDir = path.resolve(
    repoRoot,
    "tmp/qa/artifacts",
    slug(run),
    slug(testCase)
  );

  if (!existsSync(traceDir)) {
    return NextResponse.json({
      run_id: run,
      case_id: testCase,
      traces: [],
    });
  }

  const files = (await readdir(traceDir)).filter((file) =>
    file.toLowerCase().endsWith(".json")
  );

  const traces: Array<{
    file: string;
    trace_id: string | null;
    channel: string | null;
    payload: unknown;
  }> = [];

  for (const file of files) {
    const absolute = path.resolve(traceDir, file);
    const raw = await readFile(absolute, "utf8").catch(() => null);
    if (!raw) continue;
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      parsed = null;
    }
    if (!parsed) continue;
    traces.push({
      file,
      trace_id: typeof parsed.trace_id === "string" ? parsed.trace_id : null,
      channel: typeof parsed.channel === "string" ? parsed.channel : null,
      payload: parsed.payload ?? null,
    });
  }

  return NextResponse.json({
    run_id: run,
    case_id: testCase,
    traces,
  });
}
