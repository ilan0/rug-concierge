import { NextResponse } from "next/server";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { resolveRequestRole } from "@/lib/auth/request-role";
import { canRoleReadDebugTrace } from "@/lib/auth/policy";

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
  const roleResolution = await resolveRequestRole({
    defaultRole: "retail_customer",
  });

  if (!canRoleReadDebugTrace(roleResolution.role)) {
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const run = url.searchParams.get("run")?.trim() ?? "";
  const testCase = url.searchParams.get("case")?.trim() ?? "";

  if (!run || !testCase) {
    return NextResponse.json(
      { error: "run and case are required query params." },
      { status: 400 }
    );
  }

  // Tenant enforcement is intentionally skipped for this route.
  // This endpoint is developer-only and reads local debug artifact files,
  // not tenant-scoped production data from Supabase.
  const repoRoot = resolveRepoRootFromCwd();
  const traceDir = path.resolve(
    repoRoot,
    "docs/testing/artifacts",
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
