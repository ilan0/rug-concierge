import path from "node:path";
import {
  assert,
  createSupabaseAdminFromEnv,
  loadEnvLocal,
  nowIso,
  nowTag,
  parseArgs,
  resolveBaseUrl,
  unlockStaffSession,
  writeReport,
} from "./lib/common.mjs";

const ONE_PIXEL_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X2ioAAAAASUVORK5CYII=";

function makeImageFile(input) {
  return new File([input.bytes], input.name, { type: input.type });
}

function formForIntake(input) {
  const form = new FormData();
  form.set("tenant_id", input.tenantId);
  if (input.stockId !== null) {
    form.set("stock_id", input.stockId);
  }
  form.set("width_ft", String(input.widthFt));
  form.set("width_in", String(input.widthIn));
  form.set("length_ft", String(input.lengthFt));
  form.set("length_in", String(input.lengthIn));
  if (input.imageFile) {
    form.set("image", input.imageFile);
  }
  return form;
}

async function parseJson(response) {
  return response.json().catch(() => null);
}

async function runRateLimitCase(baseUrl) {
  let got429 = false;
  let lastStatus = 0;
  for (let i = 0; i < 10; i += 1) {
    const response = await fetch(`${baseUrl}/api/auth/passcode`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ passcode: "totally-wrong-passcode" }),
    });
    lastStatus = response.status;
    if (response.status === 429) {
      got429 = true;
      break;
    }
  }

  return {
    name: "passcode_rate_limit_eventually_429",
    expected_status: 429,
    actual_status: got429 ? 429 : lastStatus,
    response: { got429, lastStatus },
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const env = await loadEnvLocal();
  const baseUrl = resolveBaseUrl(args.base_url);
  const onlyRateLimit = args.only_rate_limit === "1";
  const skipRateLimit = onlyRateLimit ? false : args.skip_rate_limit === "1";
  const forwardedForBase = String(args.forwarded_for_base ?? "198.18.20").trim();
  const tenantId = String(env.TENANT_ID ?? "").trim();
  const passcode = String(env.STORE_PASSCODE ?? "").trim();
  assert(tenantId, "TENANT_ID missing in apps/web/.env.local");
  assert(passcode, "STORE_PASSCODE missing in apps/web/.env.local");

  const supabase = createSupabaseAdminFromEnv(env);
  const reportPath =
    args.report ??
    path.resolve(
      `tmp/testing/reports/contract-report-${nowTag()}-${baseUrl.includes("vercel.app") ? "prod" : "local"}.json`
    );

  const rows = [];
  const createdRugIds = [];

  const statusMatches = (expected, actual) =>
    Array.isArray(expected) ? expected.includes(actual) : actual === expected;

  const pushResult = (item) => {
    rows.push({
      ...item,
      passed: statusMatches(item.expected_status, item.actual_status),
    });
  };

  if (onlyRateLimit) {
    pushResult(await runRateLimitCase(baseUrl));
    const summary = {
      total: rows.length,
      passed: rows.filter((row) => row.passed).length,
      failed: rows.filter((row) => !row.passed).length,
    };
    const report = {
      generated_at: nowIso(),
      base_url: baseUrl,
      tenant_id: tenantId,
      mode: "only_rate_limit",
      summary,
      cases: rows,
    };
    await writeReport(reportPath, report);
    console.log(
      JSON.stringify({ ok: summary.failed === 0, report: reportPath, summary }, null, 2)
    );
    process.exit(summary.failed === 0 ? 0 : 1);
  }

  const unlockedHeaders = {
    cookie: "",
    "x-forwarded-for": `${forwardedForBase}.3`,
  };

  // Case 1: staff locked
  {
    const response = await fetch(`${baseUrl}/api/inventory/intake`, {
      method: "POST",
      headers: { "x-forwarded-for": `${forwardedForBase}.9` },
      body: formForIntake({
        tenantId,
        stockId: `CONTRACT-LOCKED-${Date.now()}`,
        widthFt: 8,
        widthIn: 0,
        lengthFt: 10,
        lengthIn: 0,
        imageFile: makeImageFile({
          bytes: Buffer.from(ONE_PIXEL_PNG_BASE64, "base64"),
          name: "locked.png",
          type: "image/png",
        }),
      }),
    });
    pushResult({
      name: "locked_staff_rejected",
      expected_status: 401,
      actual_status: response.status,
      response: await parseJson(response),
    });
  }

  // Case 2: valid passcode unlock
  const cookieHeader = await unlockStaffSession({
    baseUrl,
    passcode,
    forwardedFor: `${forwardedForBase}.1`,
  });
  unlockedHeaders.cookie = cookieHeader;
  pushResult({
    name: "passcode_unlock_success",
    expected_status: 200,
    actual_status: 200,
    response: { ok: true },
  });

  // Case 3: invalid passcode
  {
    const response = await fetch(`${baseUrl}/api/auth/passcode`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": `${forwardedForBase}.2`,
      },
      body: JSON.stringify({ passcode: `${passcode}-wrong` }),
    });
    pushResult({
      name: "passcode_unlock_invalid",
      expected_status: 401,
      actual_status: response.status,
      response: await parseJson(response),
    });
  }

  // Case 4: missing image
  {
    const response = await fetch(`${baseUrl}/api/inventory/intake`, {
      method: "POST",
      headers: unlockedHeaders,
      body: formForIntake({
        tenantId,
        stockId: `CONTRACT-NO-IMAGE-${Date.now()}`,
        widthFt: 8,
        widthIn: 0,
        lengthFt: 10,
        lengthIn: 0,
        imageFile: null,
      }),
    });
    pushResult({
      name: "missing_image_validation",
      expected_status: 400,
      actual_status: response.status,
      response: await parseJson(response),
    });
  }

  // Case 5: invalid mime
  {
    const response = await fetch(`${baseUrl}/api/inventory/intake`, {
      method: "POST",
      headers: unlockedHeaders,
      body: formForIntake({
        tenantId,
        stockId: `CONTRACT-BAD-MIME-${Date.now()}`,
        widthFt: 8,
        widthIn: 0,
        lengthFt: 10,
        lengthIn: 0,
        imageFile: makeImageFile({
          bytes: Buffer.from("not-an-image"),
          name: "bad.txt",
          type: "text/plain",
        }),
      }),
    });
    pushResult({
      name: "invalid_mime_validation",
      expected_status: 400,
      actual_status: response.status,
      response: await parseJson(response),
    });
  }

  // Case 6: oversized file (>10MB)
  {
    const bytes = Buffer.alloc(11 * 1024 * 1024, 1);
    const response = await fetch(`${baseUrl}/api/inventory/intake`, {
      method: "POST",
      headers: unlockedHeaders,
      body: formForIntake({
        tenantId,
        stockId: `CONTRACT-OVERSIZE-${Date.now()}`,
        widthFt: 8,
        widthIn: 0,
        lengthFt: 10,
        lengthIn: 0,
        imageFile: makeImageFile({
          bytes,
          name: "oversize.png",
          type: "image/png",
        }),
      }),
    });
    pushResult({
      name: "oversize_validation",
      expected_status: [400, 413],
      actual_status: response.status,
      response: await parseJson(response),
    });
  }

  // Case 7: invalid dimensions (0x0)
  {
    const response = await fetch(`${baseUrl}/api/inventory/intake`, {
      method: "POST",
      headers: unlockedHeaders,
      body: formForIntake({
        tenantId,
        stockId: `CONTRACT-BAD-DIMS-${Date.now()}`,
        widthFt: 0,
        widthIn: 0,
        lengthFt: 0,
        lengthIn: 0,
        imageFile: makeImageFile({
          bytes: Buffer.from(ONE_PIXEL_PNG_BASE64, "base64"),
          name: "baddims.png",
          type: "image/png",
        }),
      }),
    });
    pushResult({
      name: "invalid_dimensions_validation",
      expected_status: 400,
      actual_status: response.status,
      response: await parseJson(response),
    });
  }

  // Case 8: stock id too long
  {
    const response = await fetch(`${baseUrl}/api/inventory/intake`, {
      method: "POST",
      headers: unlockedHeaders,
      body: formForIntake({
        tenantId,
        stockId: "X".repeat(81),
        widthFt: 8,
        widthIn: 0,
        lengthFt: 10,
        lengthIn: 0,
        imageFile: makeImageFile({
          bytes: Buffer.from(ONE_PIXEL_PNG_BASE64, "base64"),
          name: "toolong.png",
          type: "image/png",
        }),
      }),
    });
    pushResult({
      name: "stock_id_too_long_validation",
      expected_status: 400,
      actual_status: response.status,
      response: await parseJson(response),
    });
  }

  // Case 9: valid payload accepted
  let validRugId = null;
  {
    const response = await fetch(`${baseUrl}/api/inventory/intake`, {
      method: "POST",
      headers: unlockedHeaders,
      body: formForIntake({
        tenantId,
        stockId: `CONTRACT-VALID-${Date.now()}`,
        widthFt: 8,
        widthIn: 0,
        lengthFt: 10,
        lengthIn: 0,
        imageFile: makeImageFile({
          bytes: Buffer.from(ONE_PIXEL_PNG_BASE64, "base64"),
          name: "valid.png",
          type: "image/png",
        }),
      }),
    });
    const payload = await parseJson(response);
    validRugId = typeof payload?.rug?.id === "string" ? payload.rug.id : null;
    if (validRugId) createdRugIds.push(validRugId);
    pushResult({
      name: "valid_payload_accepted",
      expected_status: 200,
      actual_status: response.status,
      response: payload,
    });
  }

  // Case 10: re-enrich missing rug
  {
    const response = await fetch(
      `${baseUrl}/api/inventory/rugs/00000000-0000-0000-0000-000000000000/re-enrich`,
      {
        method: "POST",
        headers: unlockedHeaders,
      }
    );
    pushResult({
      name: "re_enrich_missing_rug",
      expected_status: 404,
      actual_status: response.status,
      response: await parseJson(response),
    });
  }

  // Case 11: re-enrich valid row
  if (validRugId) {
    const response = await fetch(
      `${baseUrl}/api/inventory/rugs/${validRugId}/re-enrich`,
      {
        method: "POST",
        headers: unlockedHeaders,
      }
    );
    pushResult({
      name: "re_enrich_valid_row",
      expected_status: 200,
      actual_status: response.status,
      response: await parseJson(response),
    });
  }

  if (!skipRateLimit) {
    // Case 12: passcode rate limit behavior (expects eventual 429)
    pushResult(await runRateLimitCase(baseUrl));
  }

  if (createdRugIds.length > 0) {
    await supabase
      .from("rugs")
      .delete()
      .eq("tenant_id", tenantId)
      .in("id", createdRugIds);
  }

  const summary = {
    total: rows.length,
    passed: rows.filter((row) => row.passed).length,
    failed: rows.filter((row) => !row.passed).length,
  };

  const report = {
    generated_at: nowIso(),
    base_url: baseUrl,
    tenant_id: tenantId,
    mode: skipRateLimit ? "default_without_rate_limit" : "default",
    summary,
    cases: rows,
  };
  await writeReport(reportPath, report);
  console.log(JSON.stringify({ ok: summary.failed === 0, report: reportPath, summary }, null, 2));
  process.exit(summary.failed === 0 ? 0 : 1);
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
