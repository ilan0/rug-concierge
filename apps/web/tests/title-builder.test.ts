import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTradeTitle,
  sanitizeFallbackTradeLabel,
} from "../lib/inventory/title-builder";

test("maps all age categories to display tokens", () => {
  const cases: Array<{ age: string; expected: string }> = [
    { age: "antique", expected: "Antique Persian Kashan" },
    { age: "semi-antique", expected: "Semi-Antique Persian Kashan" },
    { age: "vintage", expected: "Vintage Persian Kashan" },
    { age: "traditional", expected: "Persian Kashan Traditional" },
    { age: "contemporary", expected: "Contemporary Persian Kashan" },
    { age: "new", expected: "Decorative Persian Kashan" },
  ];

  for (const item of cases) {
    const title = buildTradeTitle({
      aiFields: {
        age_category: item.age,
        origin: "Persian",
        style: "Kashan",
      },
      widthTotalIn: 96,
      lengthTotalIn: 120,
      fallbackLabel: null,
    });

    assert.equal(title, item.expected);
  }
});

test("uses origin when meaningful and drops generic origins", () => {
  const withSpecificOrigin = buildTradeTitle({
    aiFields: {
      age_category: "vintage",
      origin: "Moroccan",
      style: "Beni Ourain",
    },
    widthTotalIn: 96,
    lengthTotalIn: 120,
    fallbackLabel: null,
  });

  assert.equal(withSpecificOrigin, "Vintage Moroccan Beni Ourain");

  const withGenericOrigin = buildTradeTitle({
    aiFields: {
      age_category: "vintage",
      origin: "Central Asian",
      style: "Kazak",
    },
    widthTotalIn: 96,
    lengthTotalIn: 120,
    fallbackLabel: null,
  });

  assert.equal(withGenericOrigin, "Vintage Kazak");
});

test("includes named style and excludes pattern descriptors as style", () => {
  const namedStyleTitle = buildTradeTitle({
    aiFields: {
      age_category: "antique",
      origin: "Persian",
      style: "Heriz Serapi",
    },
    widthTotalIn: 96,
    lengthTotalIn: 120,
    fallbackLabel: null,
  });

  assert.equal(namedStyleTitle, "Antique Persian Heriz Serapi");

  const patternStyleTitle = buildTradeTitle({
    aiFields: {
      age_category: "antique",
      origin: "Persian",
      style: "Geometric",
    },
    widthTotalIn: 96,
    lengthTotalIn: 120,
    fallbackLabel: null,
  });

  assert.equal(patternStyleTitle, "Antique Persian");
});

test("appends runner qualifier when dimensions indicate runner", () => {
  const title = buildTradeTitle({
    aiFields: {
      age_category: "vintage",
      origin: "Afghan",
      style: "Gabbeh",
    },
    widthTotalIn: 30,
    lengthTotalIn: 120,
    fallbackLabel: null,
  });

  assert.equal(title, "Vintage Afghan Gabbeh Runner");
});

test("appends round qualifier when fallback text indicates round format", () => {
  const title = buildTradeTitle({
    aiFields: {
      age_category: "antique",
      origin: "Turkish",
      style: "Oushak",
    },
    widthTotalIn: 96,
    lengthTotalIn: 96,
    fallbackLabel: "Round hand-knotted rug",
  });

  assert.equal(title, "Antique Turkish Oushak Round");
});

test("returns null when the deterministic title would be one token or weaker", () => {
  const oneToken = buildTradeTitle({
    aiFields: {
      age_category: "antique",
      origin: null,
      style: null,
    },
    widthTotalIn: 96,
    lengthTotalIn: 120,
    fallbackLabel: null,
  });
  assert.equal(oneToken, null);

  const originOnly = buildTradeTitle({
    aiFields: {
      age_category: null,
      origin: "Persian",
      style: "Geometric",
    },
    widthTotalIn: 96,
    lengthTotalIn: 120,
    fallbackLabel: null,
  });
  assert.equal(originOnly, null);
});

test("does not leak color or pattern wording when structured style is strong", () => {
  const title = buildTradeTitle({
    aiFields: {
      age_category: "antique",
      origin: "Persian",
      style: "Kashan",
    },
    widthTotalIn: 96,
    lengthTotalIn: 120,
    fallbackLabel: "Red floral geometric rug",
  });

  assert.equal(title, "Antique Persian Kashan");
  assert.equal(/\b(red|floral|geometric)\b/i.test(title ?? ""), false);
});

test("rejects weak fallback labels and keeps compliant fallback labels", () => {
  assert.equal(sanitizeFallbackTradeLabel("Red geometric tribal rug"), null);
  assert.equal(sanitizeFallbackTradeLabel("4x6 Persian rug"), null);
  assert.equal(sanitizeFallbackTradeLabel("Vintage Persian Heriz"), "Vintage Persian Heriz");
});
