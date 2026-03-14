# Recommendation Structured Output Add-on

Use this prompt layer only for recommendation mode.

Runtime JSON schema validation in code is authoritative.
The model output must match that schema exactly.

Rules:
- JSON only (no prose outside JSON)
- no extra keys
- no markdown
- concise, complete string values
- use null only where schema allows null

Any mismatch should be treated as invalid output and handled by backend sanitization/fallback logic.
