# Appraisal AI Use Cases & Alignment Rules (v1)

This document defines how the AI should generate **appraisal drafts** for rug stores.
It exists to keep AI outputs accurate, conservative, and aligned with how real rug appraisals are written by store owners.

The AI **does not replace expertise**. It only drafts text using provided data.
All drafts require human review before being finalized or printed.

---

## Scope

- One appraisal = one rug
- Appraisals are created by authorized internal roles only (`store_staff`, `developer`)
- Appraisals may be for:
  - an inventory-listed rug, or
  - a customer-owned rug brought into the store

The AI **only generates draft text**. Final approval is always manual.

---

## Core Use Cases

### Use Case A — Appraisal for an inventory rug
**Trigger:**  
Staff selects a rug from inventory and creates an appraisal linked to `rug_id`.

**Inputs available to AI:**
- Appraisal fields (customer info, size, condition, appraised_value, etc.)
- Linked rug fields (style, origin, materials, colors, description, size)
- Any snapshot fields copied into the appraisal at creation time

**Expected output:**
- A professional appraisal draft describing the rug using only known facts
- Description should reflect inventory data, not reinterpret it

**Rules:**
- Do not override inventory facts
- Do not infer missing information

---

### Use Case B — Appraisal for a customer-owned rug (no inventory link)
**Trigger:**  
Staff creates an appraisal with `rug_id = null`.

**Inputs available to AI:**
- Staff-entered appraisal fields only
- No inventory data is assumed

**Expected output:**
- A conservative description based strictly on provided size, rug type label, condition, materials, colors, and motifs (if present)

**Rules:**
- Never assume origin, age, or construction
- If details are missing, acknowledge that they were not specified

---

### Use Case C — Sparse or incomplete information
**Trigger:**  
Key descriptive fields are missing (e.g., materials, origin, motifs).

**AI behavior:**
- Produce a shorter, more general description
- Explicitly avoid specificity
- Use neutral phrasing such as:
  - “Based on the information provided”
  - “As observed at the time of appraisal”

**Allowed:**
- Mentioning size, general type, and condition
- Noting that further details may require inspection

**Not allowed:**
- Guessing materials, origin, or age
- Using phrases like “likely” or “appears to be” unless store policy allows it

---

### Use Case D — Draft vs finalized appraisal
**Trigger:**  
AI generates text into `draft_text`.

**Rules:**
- AI must never overwrite `final_text`
- Once an appraisal status is `finalized`, AI generation is disabled
- All AI output is clearly marked as a draft

---

## Grounding Rules (Hard Requirements)

The AI may only use:
- Fields from the `appraisals` record
- Fields from the linked `rugs` record (if `rug_id` is present)

If a fact is not present in the data:
- It must not appear in the output

---

## Prohibited Behavior

The AI must NEVER:
- Claim authenticity or certification
- Assign an age or period unless explicitly provided
- Claim a rug is hand-knotted unless construction is specified
- Describe materials unless provided
- Guarantee insurance acceptance or resale value
- State or imply the rug’s sale price

---

## Appraised Value Rules

- The AI must label the value as **Appraised Value**
- The AI must not describe the value as a sale price
- The AI must not justify the value unless staff notes are provided

Example allowed phrasing:
> “The appraised value reflects the condition and characteristics of the rug as documented at the time of appraisal.”

---

## Tone & Style Guidelines

- Professional
- Conservative
- Neutral and factual
- Similar to a traditional in-store rug appraisal

Avoid:
- Marketing language
- Emotional language
- Overly technical jargon

---

## Output Structure (Recommended)

**Header:**
- Customer name (if provided)
- Customer address/contact (if provided)
- Appraisal date
- Rug size
- Rug type label

**Body:**
- 4–6 sentences describing:
  - design and motifs (if provided)
  - color palette (if provided)
  - materials and construction (if provided)
  - condition (from condition field)

**Value Section:**
- Appraised Value (currency and amount)


---

## Final Notes

This document exists to:
- Prevent hallucinations
- Preserve trust with customers and insurers
- Keep AI output aligned with real rug industry practices

When in doubt, the AI should **say less, not more**.

---

## Runtime Notes (Current)

- Main endpoint: `POST /api/appraisal/generate`
- Chat appraisal path: appraisal mode in `POST /api/chat`
- Non-authorized roles are blocked before generation
- Output is always treated as draft content for human review/export
