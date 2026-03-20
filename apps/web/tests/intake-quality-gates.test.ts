import assert from "node:assert/strict";
import test from "node:test";
import { reviewReasonMessage } from "../lib/inventory/enrichment-state";
import { hashBytesSha256 } from "../lib/inventory/image-hash";
import { buildTradeTitle } from "../lib/inventory/title-builder";

test("sha256 hash is stable for identical byte arrays", () => {
  const bytesA = new Uint8Array([1, 2, 3, 4, 5, 6]);
  const bytesB = new Uint8Array([1, 2, 3, 4, 5, 6]);

  const hashA = hashBytesSha256(bytesA);
  const hashB = hashBytesSha256(bytesB);

  assert.equal(hashA, hashB);
});

test("sha256 hash changes when image bytes change", () => {
  const bytesA = new Uint8Array([1, 2, 3, 4, 5, 6]);
  const bytesB = new Uint8Array([1, 2, 3, 4, 5, 7]);

  const hashA = hashBytesSha256(bytesA);
  const hashB = hashBytesSha256(bytesB);

  assert.notEqual(hashA, hashB);
});

test("buildTradeTitle null outcome maps to needs_review gate", () => {
  const nullTitle = buildTradeTitle({
    aiFields: {
      origin: null,
      style: null,
      age_category: null,
    },
    widthTotalIn: 96,
    lengthTotalIn: 120,
    fallbackLabel: null,
  });
  assert.equal(nullTitle, null);
  assert.equal(nullTitle ? "ready" : "needs_review", "needs_review");

  const validTitle = buildTradeTitle({
    aiFields: {
      origin: "Persian",
      style: "Heriz",
      age_category: "antique",
    },
    widthTotalIn: 96,
    lengthTotalIn: 120,
    fallbackLabel: null,
  });
  assert.equal(validTitle, "Antique Persian Heriz");
  assert.equal(validTitle ? "ready" : "needs_review", "ready");
});

test("review reason code messages map to expected staff copy", () => {
  assert.equal(
    reviewReasonMessage("ANALYSIS_INCOMPLETE"),
    "Analysis incomplete - AI couldn't confidently identify this rug, please verify details manually."
  );
  assert.equal(
    reviewReasonMessage("ANALYSIS_FAILED"),
    "Analysis failed - tap Re-analyze to try again, or enter details manually."
  );
  assert.equal(
    reviewReasonMessage(null),
    "Needs review - please verify this rug manually."
  );
});
