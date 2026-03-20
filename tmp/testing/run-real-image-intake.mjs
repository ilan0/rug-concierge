import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  assert,
  createSupabaseAdminFromEnv,
  loadEnvLocal,
  nowIso,
  nowTag,
  parseArgs,
  resolveBaseUrl,
  triggerWorker,
  unlockStaffSession,
  wait,
  writeReport,
} from "./lib/common.mjs";

const execFileAsync = promisify(execFile);

async function readManifest(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  const payload = JSON.parse(raw);
  if (!Array.isArray(payload?.rows)) {
    throw new Error(`Invalid manifest file: ${filePath}`);
  }
  return payload;
}

function toFileNameFromUrl(url, fallback) {
  try {
    const parsed = new URL(url);
    const last = parsed.pathname.split("/").pop();
    if (last && /\.[a-z0-9]{2,5}$/i.test(last)) {
      return last;
    }
  } catch {
    // ignore
  }
  return fallback;
}

function toImageContentType(fileName) {
  if (/\.png$/i.test(fileName)) return "image/png";
  if (/\.webp$/i.test(fileName)) return "image/webp";
  if (/\.avif$/i.test(fileName)) return "image/avif";
  return "image/jpeg";
}

async function fetchWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function downloadImageWithCurl(url) {
  const { stdout } = await execFileAsync(
    "curl",
    [
      "-L",
      "--fail",
      "--silent",
      "--show-error",
      "--max-time",
      "30",
      "-A",
      "Mozilla/5.0",
      url,
    ],
    {
      encoding: "buffer",
      maxBuffer: 20 * 1024 * 1024,
    }
  );
  return Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout);
}

function buildIntakeForm(input) {
  const form = new FormData();
  form.set("tenant_id", input.tenantId);
  form.set("stock_id", input.stockId);
  form.set("width_ft", String(input.dimensions.width_ft));
  form.set("width_in", String(input.dimensions.width_in));
  form.set("length_ft", String(input.dimensions.length_ft));
  form.set("length_in", String(input.dimensions.length_in));
  form.set(
    "image",
    new File([input.bytes], input.fileName, {
      type: toImageContentType(input.fileName),
    })
  );
  return form;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const env = await loadEnvLocal();
  const baseUrl = resolveBaseUrl(args.base_url);
  const manifestPath =
    args.manifest ??
    path.resolve("tmp/testing/manifests/manifest-real-60.json");
  const runLabel = (args.label ?? (baseUrl.includes("vercel.app") ? "prod" : "local")).trim();
  const reportPath =
    args.report ??
    path.resolve(`tmp/testing/reports/golden-run-report-${runLabel}-${nowTag()}.json`);
  const rateLimitWaitMs = Math.max(
    65_000,
    Number.parseInt(String(args.rate_limit_wait_ms ?? "70000"), 10)
  );
  const forwardedForBase = String(args.forwarded_for_base ?? "172.31.200").trim();
  const requestSpacingMs = Math.max(
    0,
    Number.parseInt(
      String(args.request_spacing_ms ?? (baseUrl.includes("vercel.app") ? "2200" : "0")),
      10
    )
  );

  const tenantId = String(env.TENANT_ID ?? "").trim();
  const passcode = String(env.STORE_PASSCODE ?? "").trim();
  const cronSecret = String(env.CRON_SECRET ?? "").trim();
  assert(tenantId, "TENANT_ID missing in apps/web/.env.local");
  assert(passcode, "STORE_PASSCODE missing in apps/web/.env.local");
  assert(cronSecret, "CRON_SECRET missing in apps/web/.env.local");

  const supabase = createSupabaseAdminFromEnv(env);
  const manifest = await readManifest(manifestPath);
  const cookieHeader = await unlockStaffSession({
    baseUrl,
    passcode,
    forwardedFor: `${forwardedForBase}.1`,
  });

  const submissions = [];
  const createdRugIds = [];
  const runPrefix = `CERT-${runLabel.toUpperCase()}-${nowTag().slice(0, 19).replaceAll("-", "")}`;

  for (let i = 0; i < manifest.rows.length; i += 1) {
    const row = manifest.rows[i];
    const stockId = `${runPrefix}-${String(i + 1).padStart(3, "0")}`;
    const startedAt = Date.now();
    console.log(`[${runLabel}] ${i + 1}/${manifest.rows.length} intake start: ${row.id}`);

    let imageBytes = null;
    let imageFileName = null;
    let downloadError = null;
    for (let downloadAttempt = 1; downloadAttempt <= 3; downloadAttempt += 1) {
      try {
        imageBytes = await downloadImageWithCurl(row.image_url);
        imageFileName = toFileNameFromUrl(row.image_url, `${row.id}.jpg`);
        if (imageBytes.length === 0) {
          throw new Error("empty_image_bytes");
        }
        downloadError = null;
        break;
      } catch (error) {
        downloadError = error instanceof Error ? error.message : String(error);
        if (downloadAttempt < 3) {
          await wait(downloadAttempt * 1000);
        }
      }
    }

    if (!imageBytes || !imageFileName) {
      submissions.push({
        row_id: row.id,
        stock_id: stockId,
        category: row.category,
        image_url: row.image_url,
        status: "download_error",
        error: downloadError ?? "download_failed",
        duration_ms: Date.now() - startedAt,
      });
      continue;
    }

    let intakeResponse = null;
    let intakePayload = null;
    let finalStatus = "error";
    let requestAttempts = 0;
    let retryAfterRateLimitCount = 0;

    while (requestAttempts < 12) {
      requestAttempts += 1;
      intakeResponse = await fetchWithTimeout(
        `${baseUrl}/api/inventory/intake`,
        {
          method: "POST",
          headers: {
            cookie: cookieHeader,
            "x-forwarded-for": `${forwardedForBase}.${((i % 200) + 2).toString()}`,
          },
          body: buildIntakeForm({
            tenantId,
            stockId,
            dimensions: row.upload_dimensions,
            bytes: imageBytes,
            fileName: imageFileName,
          }),
        },
        40_000
      );
      intakePayload = await intakeResponse.json().catch(() => null);

      if (intakeResponse.status === 429) {
        retryAfterRateLimitCount += 1;
        const waitMs = retryAfterRateLimitCount === 1 ? rateLimitWaitMs : 65_000;
        console.log(
          `[${runLabel}] ${row.id} rate limited (attempt ${requestAttempts}); waiting ${Math.round(
            waitMs / 1000
          )}s`
        );
        await wait(waitMs);
        continue;
      }

      if (intakeResponse.status === 200) {
        finalStatus = "created";
      } else if (intakeResponse.status === 409) {
        finalStatus = "duplicate_rejected";
      } else {
        finalStatus = "error";
      }
      break;
    }

    const rugId =
      intakeResponse?.status === 200 && typeof intakePayload?.rug?.id === "string"
        ? intakePayload.rug.id
        : null;
    if (rugId) createdRugIds.push(rugId);

    submissions.push({
      row_id: row.id,
      stock_id: stockId,
      category: row.category,
      image_url: row.image_url,
      status: finalStatus,
      http_status: intakeResponse?.status ?? null,
      request_attempts: requestAttempts,
      rate_limited_retries: retryAfterRateLimitCount,
      rug_id: rugId,
      response: intakePayload,
      duration_ms: Date.now() - startedAt,
    });
    console.log(
      `[${runLabel}] ${row.id} -> ${finalStatus} (${Date.now() - startedAt}ms, attempts=${requestAttempts})`
    );
    if (requestSpacingMs > 0 && i < manifest.rows.length - 1) {
      await wait(requestSpacingMs);
    }
  }

  const unresolved = new Set(createdRugIds);
  const rugRowsById = new Map();
  const workerRuns = [];
  const deadlineMs = Date.now() + 30 * 60_000;

  while (unresolved.size > 0 && Date.now() < deadlineMs) {
    const workerRun = await triggerWorker({
      baseUrl,
      cronSecret,
    });
    workerRuns.push({
      timestamp: nowIso(),
      status: workerRun.status,
      ok: workerRun.ok,
      summary: workerRun.json?.summary ?? null,
    });

    const currentIds = [...unresolved];
    const rugsResult = await supabase
      .from("rugs")
      .select(
        "id, tenant_id, stock_id, status, intake_label, ai_description, ai_structured_fields, enrichment_status, review_reason_code, width_total_in, length_total_in, created_at"
      )
      .eq("tenant_id", tenantId)
      .in("id", currentIds);
    if (rugsResult.error) {
      throw new Error(`Unable to poll rug statuses: ${rugsResult.error.message}`);
    }

    for (const rug of rugsResult.data ?? []) {
      if (!rug?.id) continue;
      rugRowsById.set(rug.id, rug);
      if (rug.enrichment_status === "ready" || rug.enrichment_status === "needs_review") {
        unresolved.delete(rug.id);
      }
    }

    if (unresolved.size === 0) break;
    await wait(2500);
  }

  const allCreatedIds = [...createdRugIds];
  let imageRows = [];
  let jobRows = [];

  if (allCreatedIds.length > 0) {
    const imageResult = await supabase
      .from("rug_images")
      .select("rug_id, path, image_sha256")
      .eq("tenant_id", tenantId)
      .in("rug_id", allCreatedIds);
    if (!imageResult.error && Array.isArray(imageResult.data)) {
      imageRows = imageResult.data;
    }

    const jobResult = await supabase
      .from("inventory_enrichment_jobs")
      .select("rug_id, state, attempt_count, max_attempts, next_attempt_at, last_error")
      .eq("tenant_id", tenantId)
      .in("rug_id", allCreatedIds);
    if (!jobResult.error && Array.isArray(jobResult.data)) {
      jobRows = jobResult.data;
    }
  }

  const report = {
    generated_at: nowIso(),
    base_url: baseUrl,
    label: runLabel,
    tenant_id: tenantId,
    manifest_path: manifestPath,
    manifest_count: manifest.rows.length,
    submission_summary: {
      created: submissions.filter((row) => row.status === "created").length,
      duplicate_rejected: submissions.filter((row) => row.status === "duplicate_rejected").length,
      error: submissions.filter((row) => row.status === "error").length,
      download_error: submissions.filter((row) => row.status === "download_error").length,
    },
    unresolved_after_timeout: [...unresolved],
    submissions,
    worker_runs: workerRuns,
    rugs: allCreatedIds.map((id) => rugRowsById.get(id) ?? { id, missing: true }),
    rug_images: imageRows,
    jobs: jobRows,
  };

  await writeReport(reportPath, report);
  const ok =
    report.submission_summary.error === 0 &&
    report.submission_summary.download_error === 0 &&
    unresolved.size === 0;
  console.log(JSON.stringify({ ok, report: reportPath, summary: report.submission_summary }, null, 2));
  process.exit(ok ? 0 : 1);
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
