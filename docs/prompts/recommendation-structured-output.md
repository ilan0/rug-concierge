# Structured Output Add-on (Recommendation Mode Only)

Use this add-on ONLY when calling the recommendation endpoint.
When used, the model must return ONLY valid JSON.

## Output Requirements (Strict)

Return ONLY valid JSON matching this schema:

{
  "mode": "recommendations" | "clarifying_question" | "no_match",
  "assistant_message": string,
  "questions": string[],
  "recommendations": {
    "rug_id": string,
    "sku": string|null,
    "title": string,
    "size_text": string|null,
    "price_usd": number|null,
    "match_reasons": string[],
    "confidence": number
  }[],
  "notes": string|null
}

Rules:
- No markdown
- No extra keys
- No text outside JSON

Mode rules:
- clarifying_question: 1–2 questions, recommendations=[]
- recommendations: 1–8 items, questions usually []
- no_match: recommendations=[], explain why, optionally 0–1 question
