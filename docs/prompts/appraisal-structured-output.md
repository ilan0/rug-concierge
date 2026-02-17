# Appraisal Structured Output (v1)

The appraisal generator must return JSON with this shape:

```json
{
  "mode": "appraisal_draft | cannot_generate",
  "assistant_message": "string",
  "draft": {
    "header": {
      "customer_name": "string | null",
      "customer_contact": "string | null",
      "appraisal_date": "string | null",
      "rug_label": "string | null",
      "rug_size_text": "string | null"
    },
    "description_paragraphs": ["string"],
    "value_section": {
      "label": "Appraised Value",
      "amount": "number | null",
      "currency": "string | null",
      "statement": "string"
    },
    "disclaimers": ["string"],
    "metadata": {
      "generated_at": "ISO datetime string",
      "schema_version": "appraisal_draft_v1"
    }
  },
  "missing_fields": ["string"],
  "notes": "string | null"
}
```

Notes:
- `draft` is `null` when `mode = "cannot_generate"`.
- Keep keys stable; export/PDF mapping depends on this contract.
