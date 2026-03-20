import { createHash, createHmac, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

function readEnvLocal(): Record<string, string> {
  const envPath = path.resolve(process.cwd(), ".env.local");
  const raw = fs.readFileSync(envPath, "utf8");
  const out: Record<string, string> = {};

  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const env = readEnvLocal();
const TENANT_ID = env.TENANT_ID?.trim() ?? "";
const SUPABASE_URL = env.SUPABASE_URL?.trim() ?? "";
const SUPABASE_SECRET_KEY = env.SUPABASE_SECRET_KEY?.trim() ?? "";
const COOKIE_SECRET = env.COOKIE_SECRET?.trim() ?? "";

if (!TENANT_ID || !SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  throw new Error(
    "TENANT_ID, SUPABASE_URL and SUPABASE_SECRET_KEY are required in .env.local"
  );
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function seedImageHash(seed: string): string {
  return createHash("sha256").update(seed).digest("hex");
}

function buildStaffCookieValue(cookieSecret: string): string {
  if (!cookieSecret) return "1";
  return createHmac("sha256", cookieSecret)
    .update("device:staff-unlock:unlocked")
    .digest("hex");
}

const STAFF_COOKIE_VALUE = buildStaffCookieValue(COOKIE_SECRET);

async function seedRug(input: {
  label: string;
  enrichmentStatus: "ready" | "needs_review" | "processing";
  reviewReasonCode: "ANALYSIS_INCOMPLETE" | "ANALYSIS_FAILED" | null;
}) {
  const id = randomUUID();

  const rugInsert = await supabase.from("rugs").insert({
    id,
    tenant_id: TENANT_ID,
    status: "available",
    stock_id: `PW-${id.slice(0, 8).toUpperCase()}`,
    width_ft: 8,
    width_in: 0,
    length_ft: 10,
    length_in: 0,
    intake_label: input.label,
    ai_description: `Seed rug for ${input.label}`,
    ai_structured_fields: {
      origin: "Persian",
      style: "Heriz",
      age_category: "antique",
    },
    enrichment_status: input.enrichmentStatus,
    review_reason_code: input.reviewReasonCode,
  });
  if (rugInsert.error) {
    throw new Error(`Failed to seed rug: ${rugInsert.error.message}`);
  }

  const imageInsert = await supabase.from("rug_images").insert({
    tenant_id: TENANT_ID,
    rug_id: id,
    path: `${TENANT_ID}/${id}/playwright-${Date.now()}.png`,
    image_sha256: seedImageHash(`${id}:${Date.now()}`),
  });
  if (imageInsert.error) {
    throw new Error(`Failed to seed rug image: ${imageInsert.error.message}`);
  }

  return { id, label: input.label };
}

async function cleanupRugs(ids: string[]) {
  if (ids.length === 0) return;
  await supabase.from("rugs").delete().eq("tenant_id", TENANT_ID).in("id", ids);
}

test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([
    {
      name: "staff_unlocked",
      value: STAFF_COOKIE_VALUE,
      url: baseURL ?? "http://localhost:4201",
    },
  ]);
});

test("inventory row shows needs review warning with reason text", async ({ page }) => {
  const seeded = await seedRug({
    label: `PW Needs Review ${Date.now()}`,
    enrichmentStatus: "needs_review",
    reviewReasonCode: "ANALYSIS_INCOMPLETE",
  });

  try {
    await page.goto("/inventory");
    const seededRow = page.locator("tr").filter({ hasText: seeded.label }).first();
    await expect(seededRow).toBeVisible();
    await expect(
      seededRow.getByText(
        "Analysis incomplete - AI couldn't confidently identify this rug, please verify details manually."
      )
    ).toBeVisible();
  } finally {
    await cleanupRugs([seeded.id]);
  }
});

test("re-analyze action transitions rug back to processing", async ({ page }) => {
  const seeded = await seedRug({
    label: `PW Reanalyze ${Date.now()}`,
    enrichmentStatus: "ready",
    reviewReasonCode: null,
  });

  try {
    await page.goto("/inventory");
    const seededRow = page.locator("tr").filter({ hasText: seeded.label }).first();
    await expect(seededRow).toBeVisible();
    await seededRow.click();

    page.once("dialog", async (dialog) => {
      await dialog.accept();
    });
    await page.getByRole("button", { name: "Re-analyze" }).click();

    const modal = page.getByRole("dialog");
    await expect(
      modal.getByText("AI analysis is running in the background.")
    ).toBeVisible();

    const rugRow = await supabase
      .from("rugs")
      .select("enrichment_status")
      .eq("tenant_id", TENANT_ID)
      .eq("id", seeded.id)
      .single();
    expect(rugRow.error).toBeNull();
    expect(rugRow.data?.enrichment_status).toBe("processing");

    const jobRow = await supabase
      .from("inventory_enrichment_jobs")
      .select("state")
      .eq("tenant_id", TENANT_ID)
      .eq("rug_id", seeded.id)
      .maybeSingle();
    expect(jobRow.error).toBeNull();
    expect(jobRow.data).not.toBeNull();
  } finally {
    await cleanupRugs([seeded.id]);
  }
});

test("delete action confirms and removes row from inventory", async ({ page }) => {
  const seeded = await seedRug({
    label: `PW Delete ${Date.now()}`,
    enrichmentStatus: "ready",
    reviewReasonCode: null,
  });

  try {
    await page.goto("/inventory");
    const seededRow = page.locator("tr").filter({ hasText: seeded.label }).first();
    await expect(seededRow).toBeVisible();
    await seededRow.click();

    page.once("dialog", async (dialog) => {
      await dialog.accept();
    });
    await page.getByRole("button", { name: "Delete rug" }).click();

    await page.waitForLoadState("networkidle");
    await expect(page.getByText(seeded.label)).toHaveCount(0);

    const rugRow = await supabase
      .from("rugs")
      .select("id")
      .eq("tenant_id", TENANT_ID)
      .eq("id", seeded.id)
      .maybeSingle();
    expect(rugRow.error).toBeNull();
    expect(rugRow.data).toBeNull();
  } finally {
    await cleanupRugs([seeded.id]);
  }
});
