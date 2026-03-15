import test from "node:test";
import assert from "node:assert/strict";
import { normalizeInventoryFilters } from "../../lib/inventory/filters";

test("normalizeInventoryFilters merges modern + legacy size presets", () => {
  const filters = normalizeInventoryFilters({
    sizePresets: "8x10,runner,8x10,invalid",
    sizePreset: "9x12",
  });

  assert.deepEqual(filters.sizePresets, ["8x10", "runner", "9x12"]);
});

test("normalizeInventoryFilters clears presets when manual bounds exist", () => {
  const filters = normalizeInventoryFilters({
    sizePresets: "8x10,runner",
    widthMin: 84,
  });

  assert.deepEqual(filters.sizePresets, []);
  assert.equal(filters.widthMin, 84);
});

test("normalizeInventoryFilters swaps min/max bounds when reversed", () => {
  const filters = normalizeInventoryFilters({
    widthMin: 120,
    widthMax: 96,
    lengthMin: 150,
    lengthMax: 108,
  });

  assert.equal(filters.widthMin, 96);
  assert.equal(filters.widthMax, 120);
  assert.equal(filters.lengthMin, 108);
  assert.equal(filters.lengthMax, 150);
});

test("normalizeInventoryFilters falls back to defaults for invalid status/sort", () => {
  const filters = normalizeInventoryFilters({
    status: "weird",
    sort: "unknown",
  });

  assert.equal(filters.status, "available");
  assert.equal(filters.sort, "newest");
});
