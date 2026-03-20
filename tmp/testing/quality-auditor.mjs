import path from "node:path";
import fs from "node:fs/promises";
import { nowIso, nowTag, parseArgs, writeReport } from "./lib/common.mjs";

function normalizeText(value) {
  if (typeof value !== "string") return "";
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSet(value) {
  const out = new Set();
  const normalized = normalizeText(value);
  for (const token of normalized.split(" ")) {
    if (token) out.add(token);
  }
  return out;
}

function tokenOverlapMatch(a, b) {
  const left = tokenSet(a);
  const right = tokenSet(b);
  if (left.size === 0 || right.size === 0) return false;
  for (const token of left) {
    if (right.has(token)) return true;
  }
  for (const token of right) {
    if (left.has(token)) return true;
  }
  return false;
}

function titleHasDimensionLeak(title) {
  return /(\b\d+\s?[x×]\s?\d+\b|\d+\s?(ft|feet|in|inch|inches)\b|\b\d+'\s*\d*\"?)/i.test(
    title
  );
}

function titleHasBannedLuxuryClaim(title) {
  return /\b(very\s+fine|fine|rare|collectible)\b/i.test(title);
}

function titleHasCommodityLead(title) {
  const normalized = String(title ?? "").trim().toLowerCase();
  if (!normalized) return true;
  return (
    /^(red|blue|green|ivory|black|brown|gold|rust|cream|beige|gray|grey|navy)\b/.test(
      normalized
    ) ||
    /^(floral|geometric|medallion|tribal|traditional)\b/.test(normalized)
  );
}

function titleHasDuplicateTokens(title) {
  const seen = new Set();
  const tokens = String(title ?? "")
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.replace(/[^a-z0-9-]/g, ""))
    .filter(Boolean);
  for (const token of tokens) {
    if (seen.has(token)) return true;
    seen.add(token);
  }
  return false;
}

function styleMatchWithEquivalents(expected, actual) {
  if (!expected || !actual) {
    return { matched: false, warning: null };
  }
  if (tokenOverlapMatch(expected, actual)) {
    return { matched: true, warning: null };
  }

  const e = normalizeText(expected);
  const a = normalizeText(actual);
  const eqHard = [
    ["qom", "qum"],
    ["heriz", "serapi"],
  ];
  for (const [x, y] of eqHard) {
    if ((e.includes(x) && a.includes(y)) || (e.includes(y) && a.includes(x))) {
      return { matched: true, warning: null };
    }
  }

  const eqSoft = [
    ["oushak", "sultanabad"],
    ["kazak", "shirvan"],
    ["gabbeh", "tribal"],
  ];
  for (const [x, y] of eqSoft) {
    if ((e.includes(x) && a.includes(y)) || (e.includes(y) && a.includes(x))) {
      return {
        matched: true,
        warning: `soft_style_equivalence:${x}<->${y}`,
      };
    }
  }

  const styleFamilies = [
    [
      "persian_classical",
      [
        "heriz",
        "serapi",
        "kashan",
        "isfahan",
        "esfahan",
        "tabriz",
        "kerman",
        "nain",
        "qom",
        "qum",
        "bidjar",
        "bijar",
        "sarouk",
        "sultanabad",
        "bakhtiari",
        "hamadan",
        "mashad",
        "qashqai",
      ],
    ],
    ["caucasian", ["kazak", "shirvan", "karabagh"]],
    ["anatolian", ["oushak", "ushak"]],
    ["moroccan", ["beni", "ourain", "azilal"]],
    ["flatweave", ["kilim", "soumak"]],
    ["tribal", ["gabbeh", "baluch", "turkmen", "bokhara"]],
  ];

  const resolveFamily = (value) => {
    const normalized = normalizeText(value);
    if (!normalized) return null;
    for (const [family, aliases] of styleFamilies) {
      if (aliases.some((alias) => normalized.includes(alias))) {
        return family;
      }
    }
    return null;
  };

  const expectedFamily = resolveFamily(expected);
  const actualFamily = resolveFamily(actual);
  if (expectedFamily && actualFamily && expectedFamily === actualFamily) {
    return {
      matched: true,
      warning: `style_family_soft_match:${expectedFamily}`,
    };
  }

  return { matched: false, warning: null };
}

function computeFormatFromDimensions(widthTotalIn, lengthTotalIn, title) {
  const shortSide = Math.min(widthTotalIn ?? 0, lengthTotalIn ?? 0);
  const longSide = Math.max(widthTotalIn ?? 0, lengthTotalIn ?? 0);
  const normalizedTitle = normalizeText(title);
  if (/\b(round|oval|circular)\b/.test(normalizedTitle)) {
    return "round_oval";
  }
  if (shortSide > 0 && longSide > 0 && shortSide <= 48 && longSide / shortSide >= 2.2) {
    return "runner";
  }
  if (shortSide >= 108 && longSide >= 132) {
    return "oversized";
  }
  return "area";
}

function readJson(filePath) {
  return fs.readFile(filePath, "utf8").then((raw) => JSON.parse(raw));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifestPath = args.manifest ?? path.resolve("tmp/testing/manifests/manifest-real-60.json");
  const runReportPath = args.run_report;
  if (!runReportPath) {
    throw new Error("--run_report=<path> is required");
  }
  const mode = (args.mode ?? "local").toLowerCase();
  const reportPath =
    args.report ??
    path.resolve(`tmp/testing/reports/quality-audit-${mode}-${nowTag()}.json`);

  const manifest = await readJson(manifestPath);
  const run = await readJson(runReportPath);
  const manifestById = new Map(manifest.rows.map((row) => [row.id, row]));
  const rugById = new Map(
    (run.rugs ?? [])
      .filter((row) => row && typeof row.id === "string")
      .map((row) => [row.id, row])
  );
  const imageCountByRug = new Map();
  for (const imageRow of run.rug_images ?? []) {
    const rugId = imageRow?.rug_id;
    if (typeof rugId !== "string") continue;
    imageCountByRug.set(rugId, (imageCountByRug.get(rugId) ?? 0) + 1);
  }
  const jobCountByRug = new Map();
  for (const jobRow of run.jobs ?? []) {
    const rugId = jobRow?.rug_id;
    if (typeof rugId !== "string") continue;
    jobCountByRug.set(rugId, (jobCountByRug.get(rugId) ?? 0) + 1);
  }

  let validCreated = 0;
  let validTitlePass = 0;
  let invalidCreated = 0;
  let invalidNeedsReview = 0;
  let originDen = 0;
  let originPass = 0;
  let styleDen = 0;
  let stylePass = 0;
  let ageFormatDen = 0;
  let ageFormatPass = 0;
  let integrityPass = 0;
  const warnings = [];
  const failures = [];
  const expectedValidCount = manifest.rows.filter((row) => row.is_valid_rug).length;
  const expectedInvalidCount = manifest.rows.filter((row) => !row.is_valid_rug).length;

  for (const submission of run.submissions ?? []) {
    const expected = manifestById.get(submission.row_id);
    if (!expected) continue;
    if (submission.status !== "created" || !submission.rug_id) {
      failures.push({
        row_id: submission.row_id,
        stock_id: submission.stock_id,
        category: expected.category,
        issue: "ingestion_failure",
        details: {
          submission_status: submission.status,
          http_status: submission.http_status ?? null,
        },
      });
      continue;
    }

    const rug = rugById.get(submission.rug_id);
    if (!rug) {
      failures.push({
        row_id: submission.row_id,
        stock_id: submission.stock_id,
        category: expected.category,
        issue: "missing_rug_record",
      });
      continue;
    }

    const imageCount = imageCountByRug.get(submission.rug_id) ?? 0;
    const jobCount = jobCountByRug.get(submission.rug_id) ?? 0;
    if (imageCount > 0 && jobCount > 0) {
      integrityPass += 1;
    } else {
      failures.push({
        row_id: submission.row_id,
        stock_id: submission.stock_id,
        category: expected.category,
        issue: "integrity_mismatch",
        details: { image_count: imageCount, job_count: jobCount },
      });
    }

    const actualFields = rug.ai_structured_fields ?? {};
    const actualOrigin = actualFields.origin ?? null;
    const actualStyle = actualFields.style ?? null;
    const actualAge = actualFields.age_category ?? null;
    const actualFormat = computeFormatFromDimensions(
      rug.width_total_in ?? null,
      rug.length_total_in ?? null,
      rug.intake_label ?? ""
    );
    const title = String(rug.intake_label ?? "").trim();
    const titleCompliant =
      title.length > 0 &&
      !titleHasDimensionLeak(title) &&
      !titleHasBannedLuxuryClaim(title) &&
      !titleHasCommodityLead(title) &&
      !titleHasDuplicateTokens(title) &&
      title.split(/\s+/).filter(Boolean).length > 1;

    if (expected.is_valid_rug) {
      validCreated += 1;
      if (titleCompliant) {
        validTitlePass += 1;
      } else {
        failures.push({
          row_id: submission.row_id,
          stock_id: submission.stock_id,
          category: expected.category,
          issue: "title_non_compliant",
          details: { title },
        });
      }

      if (expected.expected_origin) {
        originDen += 1;
        if (tokenOverlapMatch(expected.expected_origin, actualOrigin)) {
          originPass += 1;
        } else {
          failures.push({
            row_id: submission.row_id,
            stock_id: submission.stock_id,
            category: expected.category,
            issue: "origin_mismatch",
            details: { expected: expected.expected_origin, actual: actualOrigin },
          });
        }
      }

      if (expected.expected_style_family) {
        styleDen += 1;
        const styleResult = styleMatchWithEquivalents(
          expected.expected_style_family,
          actualStyle
        );
        if (styleResult.matched) {
          stylePass += 1;
          if (styleResult.warning) {
            warnings.push({
              row_id: submission.row_id,
              stock_id: submission.stock_id,
              issue: styleResult.warning,
              details: {
                expected: expected.expected_style_family,
                actual: actualStyle,
              },
            });
          }
        } else {
          failures.push({
            row_id: submission.row_id,
            stock_id: submission.stock_id,
            category: expected.category,
            issue: "style_mismatch",
            details: { expected: expected.expected_style_family, actual: actualStyle },
          });
        }
      }

      if (expected.expected_format || expected.expected_age_category_hint) {
        ageFormatDen += 1;
        const formatOk =
          !expected.expected_format || expected.expected_format === actualFormat;
        const ageOk =
          !expected.expected_age_category_hint ||
          tokenOverlapMatch(expected.expected_age_category_hint, actualAge);
        if (formatOk && ageOk) {
          ageFormatPass += 1;
        } else {
          failures.push({
            row_id: submission.row_id,
            stock_id: submission.stock_id,
            category: expected.category,
            issue: "age_or_format_mismatch",
            details: {
              expected_format: expected.expected_format ?? null,
              actual_format: actualFormat,
              expected_age: expected.expected_age_category_hint ?? null,
              actual_age: actualAge,
            },
          });
        }
      }

      if (rug.enrichment_status !== "ready") {
        failures.push({
          row_id: submission.row_id,
          stock_id: submission.stock_id,
          category: expected.category,
          issue: "valid_rug_not_ready",
          details: {
            enrichment_status: rug.enrichment_status,
            review_reason_code: rug.review_reason_code ?? null,
          },
        });
      }
    } else {
      invalidCreated += 1;
      if (rug.enrichment_status === "needs_review") {
        invalidNeedsReview += 1;
      } else {
        failures.push({
          row_id: submission.row_id,
          stock_id: submission.stock_id,
          category: expected.category,
          issue: "invalid_rug_not_needs_review",
          details: { enrichment_status: rug.enrichment_status },
        });
      }
    }
  }

  const metrics = {
    valid_created: validCreated,
    invalid_created: invalidCreated,
    integrity_rate: validCreated + invalidCreated > 0 ? integrityPass / (validCreated + invalidCreated) : 0,
    title_compliance_rate: validCreated > 0 ? validTitlePass / validCreated : 0,
    invalid_needs_review_rate: invalidCreated > 0 ? invalidNeedsReview / invalidCreated : 0,
    origin_accuracy_rate: originDen > 0 ? originPass / originDen : 0,
    style_accuracy_rate: styleDen > 0 ? stylePass / styleDen : 0,
    age_format_plausibility_rate: ageFormatDen > 0 ? ageFormatPass / ageFormatDen : 1,
    denominators: {
      origin: originDen,
      style: styleDen,
      age_format: ageFormatDen,
    },
  };

  if (validCreated === 0 && expectedValidCount > 0) {
    failures.push({
      issue: "no_valid_samples_created",
      details: {
        expected_valid: expectedValidCount,
        created_valid: validCreated,
      },
    });
  }
  if (invalidCreated === 0 && expectedInvalidCount > 0) {
    failures.push({
      issue: "no_invalid_samples_created",
      details: {
        expected_invalid: expectedInvalidCount,
        created_invalid: invalidCreated,
      },
    });
  }

  const gates = {
    title_compliance_100: metrics.title_compliance_rate === 1,
    invalid_to_needs_review_100: metrics.invalid_needs_review_rate === 1,
    origin_accuracy_ge_95: metrics.origin_accuracy_rate >= 0.95,
    style_accuracy_ge_92: metrics.style_accuracy_rate >= 0.92,
    age_format_plausibility_ge_90: metrics.age_format_plausibility_rate >= 0.9,
    integrity_100: metrics.integrity_rate === 1,
    no_critical_failures: failures.every(
      (failure) =>
        ![
          "ingestion_failure",
          "missing_rug_record",
          "integrity_mismatch",
          "valid_rug_not_ready",
          "invalid_rug_not_needs_review",
          "title_non_compliant",
          "no_valid_samples_created",
          "no_invalid_samples_created",
        ].includes(failure.issue)
    ),
  };
  const pass = Object.values(gates).every(Boolean);

  const report = {
    generated_at: nowIso(),
    mode,
    manifest_path: manifestPath,
    run_report_path: runReportPath,
    pass,
    gates,
    metrics,
    warnings,
    failures,
  };

  await writeReport(reportPath, report);
  console.log(
    JSON.stringify(
      {
        ok: pass,
        report: reportPath,
        gates,
        failure_count: failures.length,
      },
      null,
      2
    )
  );
  process.exit(pass ? 0 : 1);
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
