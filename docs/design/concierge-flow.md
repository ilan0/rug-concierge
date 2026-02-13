# Concierge Flow (v1)

## Entry Rule

All user messages route to backend first.

- If backend classifies the message as general chat, this flow is not used.
- This flow is used only when backend classifies the message as a recommendation request.
- If intent is unclear, backend asks clarifying question(s) first.

## Quick 6-Step Flow

1. Parse request + extract any constraints/preferences
2. Backend applies SQL-first filtering (availability always; budget/size when provided)
3. Backend applies final deterministic hard checks (tolerance + rotation + safety)
4. Shape candidate set (bounded deterministic order for AI context)
5. If 0 results → no-match + suggest one adjustment
6. If results → AI picks top options + reasons
7. Follow-ups (new constraints/preferences) rerun from step 1

---

## Modes

### A) General Chat (Freeform)

Use when the user is not asking to match inventory (education, care, policies, etc.).

Prompts:
- docs/prompts/system.md

Output:
- plain text

---

### B) Concierge Recommendations (Structured)

Use when the user is asking for rugs that fit constraints (size/budget/style/etc.).

Prompts (always in this order):
- docs/prompts/system.md
- docs/prompts/recommendation.md
- Optional: trade client context
- Inventory context (SQL-filtered candidate set)
- docs/prompts/recommendation-structured-output.md

Output:
- JSON only (UI renders assistant_message + rug cards)

---

## Hard Constraints (Objective)

Hard constraints are the only rules that can eliminate candidates in v1.
Some are always active; some are conditional:

1. **Availability**
   - Rugs must be currently available (e.g., `status = available`)

2. **Budget**
   - Active only when budget is provided
   - Rugs must fit within the stated budget limits
   - If a sale price exists, it is used instead of list price

3. **Size**
   - Active only when size is provided
   - Size may be provided as a label (e.g., “8x10”) or explicit dimensions
   - Rugs may be rotated; width and length are interchangeable
   - A small tolerance is allowed to account for handmade variation

Backend filtering applies these constraints **before** the AI sees inventory.

### Soft Preferences (Never Hard Filters)

These guide ranking and explanations only:
- room / use case
- practical needs (pets, kids, durability, thickness)
- style
- palette / color
- pattern
- subjective aesthetic preferences

---

## Browse Behavior (No Size/Budget)

When size and budget are not provided:
- recommendation mode remains valid
- backend still enforces availability (SQL-first)
- backend can return a bounded browse shortlist instead of forcing clarifying questions
- AI explains options and can optionally ask one narrowing question

---

## Ranking Logic (Soft Layer)

Ranking happens **after** hard constraints are applied and must never eliminate rugs.

### Goals

- Surface the best-fitting rugs first
- Make recommendations feel curated and honest
- Support follow-ups without restarting the flow

### What Ranking Uses

Ranking is based only on:
- the current user request
- explicit rug attributes
- optional trade workflow context (not taste)

No assumptions or inferred preferences are allowed.

### Ranking Priorities (v1)

1. **Match to current request**
   - stated style, palette, or pattern preferences
   - stated durability needs (pets, traffic)

2. **Practical fit (soft guidance only)**
   - room/use context influences ranking
   - never eliminates rugs

3. **Trade workflow alignment (if applicable)**
   - spec completeness
   - availability sensitivity
   - typical project scale

4. **Tie-breakers**
   - clearer descriptions
   - images available
   - controlled variety across options

### Follow-Up Behavior

- Follow-ups re-rank the same candidate set
- New preferences update ranking
- Size or budget changes trigger re-filtering

### Explainability

Each recommendation must include 2–3 short reasons
based on real rug attributes and the stated request.

---

## No-Match Logic (Objective)

No-match is returned only when the **backend candidate set is empty** after active hard constraints.

Required behavior:
- clearly state that nothing fits available inventory
- if applicable, name the limiting hard constraint(s) (size/budget/availability)
- suggest one adjustment or ask at most one clarifying question

Structured output:
- `mode = "no_match"`
- `recommendations = []`
- `assistant_message` explains the limitation
- `questions` may include 0–1 adjustment question

---

## Inventory Context

In recommendation mode, the backend injects an "AVAILABLE INVENTORY" JSON list.
The assistant must recommend ONLY from this list.

---

## Implementation Reference (Optional)

Message stack:

```js
const messages = [
  { role: "system", content: AI_SYSTEM_PROMPT },
  { role: "system", content: RECOMMENDATION_PROMPT_V1 },

  // Optional: trade context injected only if a trade client is selected/recognized
  { role: "system", content: TRADE_CLIENT_CONTEXT_BLOCK }, // preferences + notes (no secrets)

  { role: "system", content: INVENTORY_CONTEXT_BLOCK }, // hard-coded seed inventory (for now)
  { role: "system", content: STRUCTURED_OUTPUT_ADDON }, // JSON-only schema requirement
  { role: "user",   content: USER_MESSAGE }
];
```

Inventory context block (example):

```js
const INVENTORY_CONTEXT_BLOCK = `
AVAILABLE INVENTORY (authoritative – recommend ONLY from this list):

${JSON.stringify(
  inventoryRows.map(rug => ({
    id: rug.id,
    sku: rug.sku,
    label: rug.intake_label,
    size: {
      width_ft: rug.width_ft,
      width_in: rug.width_in,
      length_ft: rug.length_ft,
      length_in: rug.length_in,
      width_total_in: rug.width_total_in,
      length_total_in: rug.length_total_in
    },
    price_usd: rug.price,
    style: rug.style,
    origin_country: rug.origin_country,
    condition: rug.condition,
    palette: rug.palette,
    pattern: rug.pattern,
    notes: rug.public_description ?? null
  })),
  null,
  2
)}
`;
```

Why normalize fields:
- prevent the AI from latching onto internal data
- control which facts are allowed to appear in recommendations
