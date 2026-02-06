# Glossary (v1)

Short definitions of common terms used across the docs.

- **Appraisal**: A draft document describing a rug and its appraised value, created by store staff for review and finalization.
- **Appraisal Context**: The data fields passed into the appraisal prompt (customer info, size, condition, appraised value, etc.).
- **Context Block**: A structured payload injected into the prompt to ground the model in current data.
- **Inventory Context**: The JSON list of in-stock rugs provided to the recommendation flow.
- **RLS (Row Level Security)**: Database rules that restrict which rows a tenant can read or write.
- **Structured Output Add-on**: A prompt layer that forces JSON-only output for deterministic UI rendering.
- **System Prompt**: The highest-priority prompt that defines the assistant's identity, tone, and safety rules.
- **Task Prompt**: A prompt layer that defines the specific task (recommendation or appraisal drafting).
- **Tenant**: A single rug business using the system; all tenant data is isolated by `tenant_id`.
- **Trade Client**: A designer or trade buyer whose preferences influence recommendations.
