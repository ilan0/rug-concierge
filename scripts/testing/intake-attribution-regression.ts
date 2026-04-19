#!/usr/bin/env tsx

import assert from "node:assert/strict";
import { buildTradeTitle } from "../../apps/web/lib/inventory/title-builder";
import { resolveEffectiveFields } from "../../apps/web/lib/inventory/resolve-fields";
import { parseVisionPayload } from "../../apps/web/lib/inventory/vision-contract";

function run() {
  const exactTitle = buildTradeTitle({
    aiFields: {
      origin: "Persian",
      origin_confidence: "high",
      style: "Heriz",
      style_confidence: "high",
      age_category: "antique",
      pattern: ["geometric design"],
      mood: "traditional",
    },
    widthTotalIn: 96,
    lengthTotalIn: 132,
    fallbackLabel: "Antique Persian Heriz",
  });
  assert.equal(exactTitle, "Antique Persian Heriz");

  const softenedTitle = buildTradeTitle({
    aiFields: {
      origin: "Turkish",
      origin_confidence: "low",
      style: "Oushak",
      style_confidence: "medium",
      age_category: "traditional",
      pattern: ["floral motif"],
      mood: "traditional",
    },
    widthTotalIn: 96,
    lengthTotalIn: 120,
    fallbackLabel: "Traditional Oushak-Style Rug",
  });
  assert.equal(softenedTitle, "Traditional Oushak-Style Rug");

  const genericTitle = buildTradeTitle({
    aiFields: {
      origin: "Persian",
      origin_confidence: "low",
      style: "Heriz",
      style_confidence: "low",
      age_category: "contemporary",
      pattern: ["plain field"],
      mood: "modern",
    },
    widthTotalIn: 96,
    lengthTotalIn: 120,
    fallbackLabel: "Modern plain field rug",
  });
  assert.equal(genericTitle, "Contemporary Plain Rug");

  const effectiveFields = resolveEffectiveFields(
    "Traditional Oushak-Style Rug",
    {
      origin: "Turkish",
      origin_confidence: "low",
      style: "Oushak",
      style_confidence: "low",
      pattern: ["floral motif"],
      primary_colors: ["ivory", "rust"],
      age_category: "traditional",
      mood: "traditional",
      is_rug: true,
      is_rug_confidence: "high",
    },
    null,
    "Traditional floral rug with Oushak-like design."
  );
  assert.equal(effectiveFields.origin, null);
  assert.equal(effectiveFields.style, "Floral");

  const parsed = parseVisionPayload({
    output_text: JSON.stringify({
      intake_label: "Antique Persian Heriz",
      ai_description:
        "An antique geometric rug with a bold medallion and brick-red field.",
      ai_structured_fields: {
        origin: "Persian",
        origin_confidence: "high",
        style: "Heriz",
        style_confidence: "high",
        pattern: ["medallion center", "geometric design"],
        primary_colors: ["red", "blue"],
        age_category: "antique",
        mood: "traditional",
        is_rug: true,
        is_rug_confidence: "high",
      },
    }),
  });
  assert.ok(parsed);
  assert.equal(parsed?.aiStructuredFields?.origin_confidence, "high");
  assert.equal(parsed?.aiStructuredFields?.style_confidence, "high");
  assert.equal(parsed?.aiStructuredFields?.style, "Heriz");

  const parsedNonRug = parseVisionPayload({
    output_text: JSON.stringify({
      intake_label: "Decorative Artwork",
      ai_description: "This is not a rug. It is a manuscript page with calligraphy.",
      ai_structured_fields: {
        origin: null,
        origin_confidence: null,
        style: null,
        style_confidence: null,
        pattern: [],
        primary_colors: ["ivory"],
        age_category: null,
        mood: "traditional",
        is_rug: false,
        is_rug_confidence: "high",
      },
    }),
  });
  assert.ok(parsedNonRug);
  assert.equal(parsedNonRug?.aiStructuredFields?.is_rug, false);
  assert.equal(parsedNonRug?.aiStructuredFields?.origin, undefined);

  console.log("[intake-attribution-regression] passed");
}

run();
