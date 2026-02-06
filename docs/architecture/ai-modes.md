# AI Modes & Prompt Layers (v1)

This document explains how prompts are layered and how AI modes are selected.

---

## AI Prompt Hierarchy

AI behavior is controlled by **layered prompts**, each with a clear role.

### Prompt Layers (from highest to lowest priority)

1. **System Prompt**
   - Defines identity and trust
   - “You are a rug expert”
   - No hallucinations
   - Conservative, professional tone
   - Used in all AI calls

2. **Task Prompt**
   - Defines what the AI is doing
   - Examples:
     - recommendation logic
     - appraisal drafting logic

3. **Context Blocks**
   - Injected data for the task
   - Examples:
     - inventory snapshot
     - trade client preferences
     - appraisal fields

4. **Structured Output Add-on (when required)**
   - Enforces JSON-only output
   - Used when UI needs deterministic structure

---

## AI Modes / Flows

### A) General Chat Mode (Freeform)

Used when the user is not selecting inventory.

Examples:
- “What’s the difference between Oushak and Heriz?”
- “How do I care for a wool rug?”

**Prompts used:**
- System Prompt only

**Output:**
- Plain text

---

### B) Concierge Recommendation Mode (Structured)

Used when the user is trying to find rugs from inventory.

Examples:
- “Need an 8x10 neutral rug under $5k”
- “Any runners for a hallway?”
- “Anything lighter than the last option?”

**Prompts used (always in this order):**
1. Static: System Prompt
2. Static: Recommendation Prompt
3. Dynamic: Optional Trade Client Context
4. Dynamic: Inventory Context (hard-coded JSON now, DB query later)
5. Static: Structured Output Add-on

**Output:**
- JSON only
- Includes:
  - user-facing message
  - clarifying questions OR
  - recommendations OR
  - no-match explanation

The UI renders text and cards from this JSON.

Missing constraints do **not** exit this mode.
They return `mode = "clarifying_question"` instead.

---

### C) Appraisal Draft Mode (Internal)

Used by owner/staff only.

Examples:
- “Generate appraisal draft for this rug”
- “Create appraisal for customer-owned rug”

**Prompts used:**
1. Static: System Prompt
2. Static: Appraisal Draft Prompt
3. Dynamic: Appraisal Context
4. Dynamic: Optional Rug Context
5. Static: Structured Output Add-on

**Output:**
- Draft text + metadata
- Clearly marked as non-final
- Owner/staff reviews and edits before saving

Appraisals are separate from recommendations and never mixed.

---

## Trade Clients (Designers)

Trade clients are **context**, not a separate AI mode.

When present:
- their preferences are injected as a context block
- they influence ranking and phrasing
- they do not change output structure

The same recommendation logic is reused.
