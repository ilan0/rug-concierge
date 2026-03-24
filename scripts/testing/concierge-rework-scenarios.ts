#!/usr/bin/env tsx

import { compileTurnPolicy } from "../../apps/web/lib/chat/policy-compiler";
import {
  parsedTurnSchema,
  type ParsedTurn,
} from "../../apps/web/lib/chat/turn-parser-contract";
import {
  extractConstraintsFromUserMessage,
  normalizeHardConstraints,
} from "../../apps/web/lib/filters/extract-constraints";
import { toSimilaritySizePreset } from "../../apps/web/lib/inventory/size-presets";
import {
  isReasonableLongSideRatio,
  isWithinRelaxedBucketDistance,
  resolveRequestedSizePreset,
} from "../../apps/web/lib/recommend/size-similarity-policy";

type ScenarioResult = {
  name: string;
  passed: boolean;
  details?: string;
};

const results: ScenarioResult[] = [];

function check(name: string, condition: boolean, details?: string): void {
  results.push({
    name,
    passed: condition,
    details,
  });
}

function makeParsedTurn(overrides: Partial<ParsedTurn>): ParsedTurn {
  return {
    mode: "recommendation",
    followup_intent: "none",
    constraints: {
      size: null,
      colors: [],
      styles: [],
      shape: null,
    },
    strictness: {
      size: "prefer",
      colors: "prefer",
      styles: "prefer",
      shape: "prefer",
    },
    avoid: {
      colors: [],
      styles: [],
      shapes: [],
    },
    session_facts: [],
    confidence: "high",
    ...overrides,
  };
}

function run(): number {
  const extracted = extractConstraintsFromUserMessage(
    "Need an 8 by 10 navy rug for my living room"
  );
  check(
    "extracts '8 by 10' dimensions",
    Boolean(
      extracted.size &&
        extracted.size.widthIn === 96 &&
        extracted.size.lengthIn === 120
    ),
    JSON.stringify(extracted.size)
  );
  check(
    "extracts canonical blue color from navy",
    Boolean(extracted.colors?.includes("blue")),
    JSON.stringify(extracted.colors)
  );

  const normalized = normalizeHardConstraints({
    size: { widthIn: 96, lengthIn: 120 },
    colors: ["blue"],
    strictness: { size: "must", colors: "prefer" },
    avoid_preferences: {
      colors: ["red"],
      styles: ["floral"],
      shapes: ["runner"],
    },
  });

  check(
    "normalizes strictness object",
    normalized.strictness?.size === "must" &&
      normalized.strictness?.colors === "prefer",
    JSON.stringify(normalized.strictness)
  );
  check(
    "normalizes avoid preferences",
    Boolean(
      normalized.avoid_preferences?.colors?.includes("red") &&
        normalized.avoid_preferences?.styles?.includes("floral") &&
        normalized.avoid_preferences?.shapes?.includes("runner")
    ),
    JSON.stringify(normalized.avoid_preferences)
  );

  const mustPolicy = compileTurnPolicy({
    parsedTurn: makeParsedTurn({
      constraints: {
        size: { widthIn: 96, lengthIn: 120 },
        colors: ["blue"],
        styles: [],
        shape: null,
      },
      strictness: {
        size: "must",
        colors: "prefer",
        styles: "prefer",
        shape: "prefer",
      },
    }),
  });
  check(
    "compile policy sets tolerance 0 for strict size",
    mustPolicy.hard_constraints.size?.toleranceIn === 0,
    JSON.stringify(mustPolicy.hard_constraints.size)
  );

  const preferPolicy = compileTurnPolicy({
    parsedTurn: makeParsedTurn({
      constraints: {
        size: { widthIn: 96, lengthIn: 120 },
        colors: ["blue"],
        styles: [],
        shape: null,
      },
      strictness: {
        size: "prefer",
        colors: "prefer",
        styles: "prefer",
        shape: "prefer",
      },
    }),
  });
  check(
    "compile policy sets positive tolerance for preferred size",
    Boolean(
      preferPolicy.hard_constraints.size &&
        typeof preferPolicy.hard_constraints.size.toleranceIn === "number" &&
        preferPolicy.hard_constraints.size.toleranceIn > 0
    ),
    JSON.stringify(preferPolicy.hard_constraints.size)
  );

  const requestedPreset = resolveRequestedSizePreset({
    widthIn: 600,
    lengthIn: 600,
  });
  const candidatePreset = toSimilaritySizePreset({
    widthIn: 108,
    lengthIn: 144,
  });
  check(
    "size guard blocks absurd 50ft vs 9x12 comparison",
    !isReasonableLongSideRatio({
      requestedLongSideIn: 600,
      candidateLongSideIn: 144,
    }),
    JSON.stringify({ requestedPreset, candidatePreset })
  );

  const nearRequestedPreset = resolveRequestedSizePreset({
    widthIn: 96,
    lengthIn: 120,
  });
  const nearCandidatePreset = toSimilaritySizePreset({
    widthIn: 108,
    lengthIn: 144,
  });
  check(
    "size guard allows nearby 8x10 vs 9x12 comparison",
    isWithinRelaxedBucketDistance({
      requestedPreset: nearRequestedPreset,
      candidatePreset: nearCandidatePreset,
    }) &&
      isReasonableLongSideRatio({
        requestedLongSideIn: 120,
        candidateLongSideIn: 144,
      }),
    JSON.stringify({ nearRequestedPreset, nearCandidatePreset })
  );

  const parsedDiscovery = parsedTurnSchema.safeParse({
    mode: "discovery",
    followup_intent: "none",
    constraints: {
      size: null,
      colors: [],
      styles: [],
      shape: null,
    },
    strictness: {
      size: "prefer",
      colors: "prefer",
      styles: "prefer",
      shape: "prefer",
    },
    avoid: {
      colors: [],
      styles: [],
      shapes: [],
    },
    session_facts: ["room: living room", "has gray sectional"],
    rug_reference_ambiguous: false,
    confidence: "high",
  });
  check(
    "parser contract accepts discovery mode with session_facts",
    parsedDiscovery.success &&
      parsedDiscovery.data.mode === "discovery" &&
      parsedDiscovery.data.session_facts.length === 2
  );

  const parsedReference = parsedTurnSchema.safeParse({
    mode: "recommendation_followup",
    followup_intent: "more_like_this",
    constraints: {
      size: null,
      colors: [],
      styles: [],
      shape: null,
    },
    strictness: {
      size: "prefer",
      colors: "prefer",
      styles: "prefer",
      shape: "prefer",
    },
    avoid: {
      colors: [],
      styles: [],
      shapes: [],
    },
    session_facts: [],
    referenced_rug_id: "rug-1",
    rug_reference_ambiguous: false,
    confidence: "medium",
  });
  check(
    "parser contract accepts referenced_rug_id",
    parsedReference.success &&
      parsedReference.data.referenced_rug_id === "rug-1" &&
      parsedReference.data.rug_reference_ambiguous === false
  );

  const disambiguationResponse = {
    mode: "disambiguation",
    assistant_message:
      "I want to make sure I’m following correctly. Did you mean Afghan Gabbeh or Rust Oushak?",
    recommendations: [
      { rug_id: "rug-1", title: "Afghan Gabbeh" },
      { rug_id: "rug-2", title: "Rust Oushak" },
    ],
  };
  check(
    "disambiguation fixture keeps recommendation mode contract",
    disambiguationResponse.mode === "disambiguation" &&
      disambiguationResponse.recommendations.length >= 2 &&
      disambiguationResponse.recommendations.length <= 3,
    JSON.stringify({
      mode: disambiguationResponse.mode,
      count: disambiguationResponse.recommendations.length,
    })
  );

  for (const result of results) {
    const status = result.passed ? "PASS" : "FAIL";
    const suffix = result.details ? ` :: ${result.details}` : "";
    console.log(`[${status}] ${result.name}${suffix}`);
  }

  const failed = results.filter((result) => !result.passed);
  console.log(
    `\nScenario summary: ${results.length - failed.length}/${results.length} passed.`
  );

  return failed.length === 0 ? 0 : 1;
}

process.exitCode = run();
