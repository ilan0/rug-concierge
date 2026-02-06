# Concierge Flow (v1)

This project has runtime lanes:
1) General Chat (freeform)
2) Concierge Recommendations (structured)
3) Appraisal mode...

## A) General Chat (freeform)
Use when the user is not asking to match inventory (education, care, policies, etc.)

Prompts:
- system-prompt.md

Output:
- plain text

## B) Concierge Recommendations (structured)
Use when the user is asking for rugs that fit constraints (size/budget/style/etc.)

Prompts (always in this order):
- system-prompt.md
- recommendation-prompt.md
- Optional: Trade_client context
- Inventory context (hard-coded JSON now; DB results later)
- recommendation-structured-output.md

Output:
- JSON only (UI renders assistant_message + rug cards)

## Inventory Context
In recommendation mode, the backend injects an "AVAILABLE INVENTORY" JSON list.
The assistant must recommend ONLY from this list.

## Why structured output
Structured JSON enables:
- reliable UI cards and buttons
- saving shortlists
- consistent testing/logging
- safer behavior (no accidental freeform blobs)