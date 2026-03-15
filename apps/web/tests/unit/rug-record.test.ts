import test from "node:test";
import assert from "node:assert/strict";
import {
  parseRugRecord,
  toInventoryBrowserRow,
  toStaffInventoryRugDetail,
} from "../../lib/inventory/rug-record";

test("parseRugRecord normalizes valid row", () => {
  const row = parseRugRecord({
    id: "a8be676e-5bfe-4692-8481-2dc7fc92ad0c",
    tenant_id: "tenant-a",
    intake_label: "Colorful wool rug",
    ai_description: "Good fit for living room.",
    ai_structured_fields: { mood: "traditional", pattern: ["medallion center"] },
    staff_overrides: { label: "Override Label" },
    stock_id: "SKU-123",
    status: "available",
    width_total_in: 96,
    length_total_in: 120,
    created_at: "2026-03-15T00:00:00.000Z",
  });

  assert.ok(row);
  assert.equal(row.id, "a8be676e-5bfe-4692-8481-2dc7fc92ad0c");
  assert.equal(row.staff_overrides?.label, "Override Label");
});

test("toInventoryBrowserRow prefers effective override label", () => {
  const row = parseRugRecord({
    id: "a8be676e-5bfe-4692-8481-2dc7fc92ad0c",
    tenant_id: "tenant-a",
    intake_label: "Base Label",
    ai_description: null,
    ai_structured_fields: { mood: "traditional" },
    staff_overrides: { label: "Override Label" },
    stock_id: null,
    status: "available",
    width_total_in: 48,
    length_total_in: 72,
    created_at: null,
  });

  assert.ok(row);
  const browser = toInventoryBrowserRow(row);
  assert.equal(browser.effective_label, "Override Label");
});

test("toStaffInventoryRugDetail includes effective fields", () => {
  const row = parseRugRecord({
    id: "a8be676e-5bfe-4692-8481-2dc7fc92ad0c",
    tenant_id: "tenant-a",
    intake_label: "Base Label",
    ai_description: "desc",
    ai_structured_fields: { mood: "traditional", style: "Heriz" },
    staff_overrides: { mood: "modern" },
    stock_id: "SKU-1",
    status: "available",
    width_total_in: 60,
    length_total_in: 96,
    created_at: "2026-03-15T00:00:00.000Z",
  });
  assert.ok(row);
  const detail = toStaffInventoryRugDetail({
    row,
    primaryImageUrl: "https://example.com/image.jpg",
    primaryImageCaption: null,
  });
  assert.equal(detail.effective_fields.mood, "modern");
  assert.equal(detail.stock_id, "SKU-1");
});
