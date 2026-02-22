# Structured Output Add-on (Recommendation Mode Only)

Use this layer only for recommendation-mode calls.

Runtime JSON schema enforcement is the source of truth.
Follow that schema exactly and return JSON only.

Rules:
- No markdown
- No extra keys
- No explanatory text outside JSON

If a value is unknown, use allowed null fields from the runtime schema.
Do not invent fields or shape variants.
