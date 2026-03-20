import { createHmac } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

type IntakeRequestFields = {
  width_ft: string | null;
  width_in: string | null;
  length_ft: string | null;
  length_in: string | null;
  stock_id: string | null;
};

function parseMultipartField(body: Buffer | null, field: string): string | null {
  if (!body) return null;
  const text = body.toString("utf8");
  const marker = `name="${field}"`;
  const fieldIndex = text.indexOf(marker);
  if (fieldIndex < 0) return null;

  const valueStart = text.indexOf("\r\n\r\n", fieldIndex);
  if (valueStart < 0) return null;
  const contentStart = valueStart + 4;
  const contentEnd = text.indexOf("\r\n", contentStart);
  if (contentEnd < 0) return null;

  return text.slice(contentStart, contentEnd);
}

function parseIntakeRequestFields(body: Buffer | null): IntakeRequestFields {
  return {
    width_ft: parseMultipartField(body, "width_ft"),
    width_in: parseMultipartField(body, "width_in"),
    length_ft: parseMultipartField(body, "length_ft"),
    length_in: parseMultipartField(body, "length_in"),
    stock_id: parseMultipartField(body, "stock_id"),
  };
}

function buildSuccessPayload(index: number) {
  return {
    rug: {
      id: `rug-${index}`,
      stock_id: `AUTO-${index}`,
      intake_label: null,
      ai_description: null,
      status: "available",
      enrichment_status: "processing",
      review_reason_code: null,
      width_total_in: 96,
      length_total_in: 120,
      primary_image_url: null,
    },
    ai_status: "processing",
  };
}

const IMAGE_A = Buffer.from("playwright-image-a");
const IMAGE_B = Buffer.from("playwright-image-b");

function readEnvValue(name: string): string {
  const envPath = path.resolve(process.cwd(), ".env.local");
  const raw = fs.readFileSync(envPath, "utf8");
  const line = raw
    .split(/\r?\n/)
    .find((entry) => entry.trim().startsWith(`${name}=`));
  if (!line) {
    return "";
  }
  const value = line.slice(line.indexOf("=") + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function buildStaffCookieValue(cookieSecret: string): string {
  if (!cookieSecret) return "1";
  return createHmac("sha256", cookieSecret)
    .update("device:staff-unlock:unlocked")
    .digest("hex");
}

const COOKIE_SECRET = readEnvValue("COOKIE_SECRET");
const STAFF_COOKIE_VALUE = buildStaffCookieValue(COOKIE_SECRET);

function buildImageFile(name: string, buffer: Buffer) {
  return {
    name,
    mimeType: "image/jpeg",
    buffer,
  };
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

test("batch intake uses shared dimensions with per-photo override and shows completion summary", async ({
  page,
}) => {
  await page.goto("/intake");
  await expect(page.getByRole("button", { name: "Single" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Batch" })).toBeVisible();

  const requests: IntakeRequestFields[] = [];

  await page.route("**/api/inventory/intake", async (route) => {
    const fields = parseIntakeRequestFields(route.request().postDataBuffer());
    requests.push(fields);
    await new Promise((resolve) => setTimeout(resolve, 120));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(buildSuccessPayload(requests.length)),
    });
  });

  await page.getByRole("button", { name: "Batch" }).click();

  await page.locator('input[type="file"][multiple]').setInputFiles([
    buildImageFile("photo-1.jpg", IMAGE_A),
    buildImageFile("photo-2.jpg", IMAGE_B),
  ]);

  await page.getByPlaceholder("Width ft").first().fill("8");
  await page.getByPlaceholder("Width in").first().fill("0");
  await page.getByPlaceholder("Length ft").first().fill("10");
  await page.getByPlaceholder("Length in").first().fill("0");

  const firstPhotoCard = page.locator("article").filter({ hasText: "Photo 1" }).first();
  await firstPhotoCard
    .getByLabel("Override dimensions for this photo")
    .check();
  await firstPhotoCard.getByPlaceholder("Width ft").fill("3");
  await firstPhotoCard.getByPlaceholder("Width in").fill("0");
  await firstPhotoCard.getByPlaceholder("Length ft").fill("5");
  await firstPhotoCard.getByPlaceholder("Length in").fill("0");
  await firstPhotoCard.getByPlaceholder("SKU").fill("SKU-OVERRIDE");

  const secondPhotoCard = page.locator("article").filter({ hasText: "Photo 2" }).first();
  await secondPhotoCard.getByPlaceholder("SKU").fill("SKU-SHARED");

  await page.getByRole("button", { name: "Upload Batch" }).click();

  await expect(firstPhotoCard.getByText("Uploading", { exact: true })).toBeVisible();
  await expect(page.getByText("Batch complete")).toBeVisible();
  await expect(page.getByText("2 created")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open inventory" })).toBeVisible();

  expect(requests).toHaveLength(2);

  expect(requests[0]).toMatchObject({
    width_ft: "3",
    width_in: "0",
    length_ft: "5",
    length_in: "0",
    stock_id: "SKU-OVERRIDE",
  });
  expect(requests[1]).toMatchObject({
    width_ft: "8",
    width_in: "0",
    length_ft: "10",
    length_in: "0",
    stock_id: "SKU-SHARED",
  });
});

test("batch intake marks local duplicates and handles server duplicate responses", async ({
  page,
}) => {
  let callCount = 0;
  const requests: IntakeRequestFields[] = [];

  await page.route("**/api/inventory/intake", async (route) => {
    callCount += 1;
    requests.push(parseIntakeRequestFields(route.request().postDataBuffer()));

    if (callCount === 2) {
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          error: "This photo matches a rug that already exists in inventory.",
          code: "DUPLICATE_IMAGE",
          existing_rug: {
            id: "existing-rug-id",
            label: "Vintage Persian Heriz",
          },
        }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(buildSuccessPayload(callCount)),
    });
  });

  await page.goto("/intake");
  await page.getByRole("button", { name: "Batch" }).click();

  await page.locator('input[type="file"][multiple]').setInputFiles([
    buildImageFile("photo-a-1.jpg", IMAGE_A),
    buildImageFile("photo-a-duplicate.jpg", IMAGE_A),
    buildImageFile("photo-b.jpg", IMAGE_B),
  ]);

  await page.getByPlaceholder("Width ft").first().fill("8");
  await page.getByPlaceholder("Width in").first().fill("0");
  await page.getByPlaceholder("Length ft").first().fill("10");
  await page.getByPlaceholder("Length in").first().fill("0");

  await expect(page.getByText("Local duplicate")).toBeVisible();

  await page.getByRole("button", { name: "Upload Batch" }).click();

  await expect(page.getByText("Batch complete")).toBeVisible();
  await expect(page.getByText("1 created")).toBeVisible();
  await expect(page.getByText("2 duplicates")).toBeVisible();
  await expect(
    page.getByText('Duplicate detected: matches "Vintage Persian Heriz".')
  ).toBeVisible();

  // One local duplicate should be skipped before API submission.
  expect(requests).toHaveLength(2);
});

test("batch intake enforces max 3 concurrent upload requests", async ({ page }) => {
  let inFlight = 0;
  let maxInFlight = 0;
  let callCount = 0;

  await page.route("**/api/inventory/intake", async (route) => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    callCount += 1;
    await new Promise((resolve) => setTimeout(resolve, 150));
    inFlight -= 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(buildSuccessPayload(callCount)),
    });
  });

  await page.goto("/intake");
  await page.getByRole("button", { name: "Batch" }).click();

  const files = Array.from({ length: 8 }, (_, index) =>
    buildImageFile(`photo-${index + 1}.jpg`, Buffer.from(`image-${index + 1}`))
  );
  await page.locator('input[type="file"][multiple]').setInputFiles(files);

  await page.getByPlaceholder("Width ft").first().fill("8");
  await page.getByPlaceholder("Width in").first().fill("0");
  await page.getByPlaceholder("Length ft").first().fill("10");
  await page.getByPlaceholder("Length in").first().fill("0");

  await page.getByRole("button", { name: "Upload Batch" }).click();
  await expect(page.getByText("Batch complete")).toBeVisible();
  await expect(page.getByText("8 created")).toBeVisible();

  expect(maxInFlight).toBeGreaterThan(1);
  expect(maxInFlight).toBeLessThanOrEqual(3);
});

test("batch intake enforces 20-photo cap", async ({ page }) => {
  await page.goto("/intake");
  await page.getByRole("button", { name: "Batch" }).click();

  const files = Array.from({ length: 21 }, (_, index) =>
    buildImageFile(`limit-${index + 1}.jpg`, Buffer.from(`limit-${index + 1}`))
  );
  await page.locator('input[type="file"][multiple]').setInputFiles(files);

  await expect(
    page.getByText("Batch limit is 20. Added 20 photo(s), skipped 1.")
  ).toBeVisible();
});

test("batch intake reports mixed outcomes with 3 duplicates out of 5", async ({ page }) => {
  let callCount = 0;
  const requests: IntakeRequestFields[] = [];

  await page.route("**/api/inventory/intake", async (route) => {
    callCount += 1;
    requests.push(parseIntakeRequestFields(route.request().postDataBuffer()));

    if (callCount === 3) {
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          error: "This photo matches a rug that already exists in inventory.",
          code: "DUPLICATE_IMAGE",
          existing_rug: {
            id: "existing-rug-id-2",
            label: "Antique Persian Heriz",
          },
        }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(buildSuccessPayload(callCount)),
    });
  });

  await page.goto("/intake");
  await page.getByRole("button", { name: "Batch" }).click();
  await page.locator('input[type="file"][multiple]').setInputFiles([
    buildImageFile("photo-a-1.jpg", IMAGE_A),
    buildImageFile("photo-a-2.jpg", IMAGE_A),
    buildImageFile("photo-a-3.jpg", IMAGE_A),
    buildImageFile("photo-b.jpg", IMAGE_B),
    buildImageFile("photo-c.jpg", Buffer.from("playwright-image-c")),
  ]);

  await page.getByPlaceholder("Width ft").first().fill("8");
  await page.getByPlaceholder("Width in").first().fill("0");
  await page.getByPlaceholder("Length ft").first().fill("10");
  await page.getByPlaceholder("Length in").first().fill("0");

  await page.getByRole("button", { name: "Upload Batch" }).click();

  await expect(page.getByText("Batch complete")).toBeVisible();
  await expect(page.getByText("2 created")).toBeVisible();
  await expect(page.getByText("3 duplicates")).toBeVisible();
  await expect(page.getByText('Duplicate detected: matches "Antique Persian Heriz".')).toBeVisible();
  expect(requests).toHaveLength(3);
});
