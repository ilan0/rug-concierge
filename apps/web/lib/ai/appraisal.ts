import type {
  AppraisalDraftResponse,
  AppraisalInput,
} from "@/lib/types/appraisal";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-4.1-nano";

const APPRAISAL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["mode", "assistant_message", "draft", "missing_fields", "notes"],
  properties: {
    mode: { type: "string", enum: ["appraisal_draft", "cannot_generate"] },
    assistant_message: { type: "string" },
    draft: {
      type: ["object", "null"],
      additionalProperties: false,
      required: [
        "header",
        "description_paragraphs",
        "value_section",
        "disclaimers",
        "metadata",
      ],
      properties: {
        header: {
          type: "object",
          additionalProperties: false,
          required: [
            "customer_name",
            "customer_contact",
            "appraisal_date",
            "rug_label",
            "rug_size_text",
          ],
          properties: {
            customer_name: { type: ["string", "null"] },
            customer_contact: { type: ["string", "null"] },
            appraisal_date: { type: ["string", "null"] },
            rug_label: { type: ["string", "null"] },
            rug_size_text: { type: ["string", "null"] },
          },
        },
        description_paragraphs: { type: "array", items: { type: "string" } },
        value_section: {
          type: "object",
          additionalProperties: false,
          required: ["label", "amount", "currency", "statement"],
          properties: {
            label: { type: "string", const: "Appraised Value" },
            amount: { type: ["number", "null"] },
            currency: { type: ["string", "null"] },
            statement: { type: "string" },
          },
        },
        disclaimers: { type: "array", items: { type: "string" } },
        metadata: {
          type: "object",
          additionalProperties: false,
          required: ["generated_at", "schema_version"],
          properties: {
            generated_at: { type: "string" },
            schema_version: { type: "string", const: "appraisal_draft_v1" },
          },
        },
      },
    },
    missing_fields: { type: "array", items: { type: "string" } },
    notes: { type: ["string", "null"] },
  },
} as const;

function fallbackDraft(input: AppraisalInput): AppraisalDraftResponse {
  if (input.status === "finalized") {
    return {
      mode: "cannot_generate",
      assistant_message:
        "This appraisal is finalized, so AI draft generation is disabled.",
      draft: null,
      missing_fields: [],
      notes: "Finalized appraisal cannot be regenerated.",
    };
  }

  return {
    mode: "appraisal_draft",
    assistant_message:
      "Here is a draft appraisal document based on the provided information.",
    draft: {
      header: {
        customer_name: input.customer_name ?? null,
        customer_contact: input.customer_contact ?? null,
        appraisal_date: input.appraisal_date ?? null,
        rug_label: input.rug_label ?? null,
        rug_size_text: input.rug_size_text ?? null,
      },
      description_paragraphs: [
        "This draft is based only on the details provided at the time of appraisal.",
        input.condition
          ? `Condition is recorded as: ${input.condition}.`
          : "Condition details were not fully specified.",
      ],
      value_section: {
        label: "Appraised Value",
        amount: typeof input.appraised_value === "number" ? input.appraised_value : null,
        currency: input.currency ?? "USD",
        statement:
          "The appraised value reflects the condition and characteristics documented at the time of appraisal.",
      },
      disclaimers: [
        "This is a draft for internal review only.",
        "No unstated origin, age, materials, or authenticity claims are included.",
      ],
      metadata: {
        generated_at: new Date().toISOString(),
        schema_version: "appraisal_draft_v1",
      },
    },
    missing_fields: findMissingFields(input),
    notes: "Fallback response used.",
  };
}

function findMissingFields(input: AppraisalInput): string[] {
  const missing: string[] = [];
  if (!input.rug_label) missing.push("rug_label");
  if (!input.rug_size_text) missing.push("rug_size_text");
  if (!input.condition) missing.push("condition");
  if (typeof input.appraised_value !== "number") missing.push("appraised_value");
  return missing;
}

function isAppraisalDraftResponse(value: unknown): value is AppraisalDraftResponse {
  if (!value || typeof value !== "object") return false;
  const data = value as Record<string, unknown>;
  if (data.mode !== "appraisal_draft" && data.mode !== "cannot_generate") {
    return false;
  }

  if (typeof data.assistant_message !== "string") return false;
  if (!Array.isArray(data.missing_fields)) return false;
  if (!data.missing_fields.every((item) => typeof item === "string")) return false;
  if (!(typeof data.notes === "string" || data.notes === null)) return false;

  if (data.draft === null) return true;
  if (!data.draft || typeof data.draft !== "object") return false;

  const draft = data.draft as Record<string, unknown>;
  if (!draft.header || typeof draft.header !== "object") return false;
  if (!Array.isArray(draft.description_paragraphs)) return false;
  if (
    !draft.description_paragraphs.every((item) => typeof item === "string")
  ) {
    return false;
  }
  if (!draft.value_section || typeof draft.value_section !== "object") return false;
  if (!Array.isArray(draft.disclaimers)) return false;
  if (!draft.disclaimers.every((item) => typeof item === "string")) return false;
  if (!draft.metadata || typeof draft.metadata !== "object") return false;

  return true;
}

function extractOutputText(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const data = payload as Record<string, unknown>;

  if (typeof data.output_text === "string" && data.output_text.trim()) {
    return data.output_text;
  }

  if (!Array.isArray(data.output)) return null;

  for (const item of data.output) {
    if (!item || typeof item !== "object") continue;
    const outputItem = item as Record<string, unknown>;
    if (!Array.isArray(outputItem.content)) continue;
    for (const content of outputItem.content) {
      if (!content || typeof content !== "object") continue;
      const part = content as Record<string, unknown>;
      if (typeof part.text === "string" && part.text.trim()) {
        return part.text;
      }
    }
  }

  return null;
}

function parseAppraisalResponse(payload: unknown): AppraisalDraftResponse | null {
  const outputText = extractOutputText(payload);
  if (outputText) {
    try {
      const parsed = JSON.parse(outputText) as unknown;
      return isAppraisalDraftResponse(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  return null;
}

function sanitize(
  response: AppraisalDraftResponse,
  input: AppraisalInput
): AppraisalDraftResponse {
  if (input.status === "finalized") {
    return {
      mode: "cannot_generate",
      assistant_message:
        "This appraisal is finalized, so AI draft generation is disabled.",
      draft: null,
      missing_fields: [],
      notes: "Finalized appraisal cannot be regenerated.",
    };
  }

  if (response.mode === "cannot_generate") {
    return {
      ...response,
      draft: null,
    };
  }

  if (!response.draft) {
    return fallbackDraft(input);
  }

  return {
    ...response,
    missing_fields: response.missing_fields.slice(0, 8),
    draft: {
      ...response.draft,
      description_paragraphs: response.draft.description_paragraphs.slice(0, 6),
      disclaimers: response.draft.disclaimers.slice(0, 5),
      metadata: {
        generated_at: response.draft.metadata.generated_at || new Date().toISOString(),
        schema_version: "appraisal_draft_v1",
      },
    },
  };
}

export async function generateAppraisalDraft(
  input: AppraisalInput
): Promise<AppraisalDraftResponse> {
  if (input.status === "finalized") {
    return fallbackDraft(input);
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      ...fallbackDraft(input),
      notes: "Missing OPENAI_API_KEY. Returned local fallback.",
    };
  }

  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text:
                "You draft conservative rug appraisal documents for internal store staff. Use only provided facts. Never guess origin, age, authenticity, or materials.",
            },
            {
              type: "input_text",
              text:
                "Output must be structured for downstream PDF export and always label value as Appraised Value.",
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `Generate appraisal draft using only these fields:\n${JSON.stringify(
                input,
                null,
                2
              )}`,
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "appraisal_draft_response",
          schema: APPRAISAL_SCHEMA,
          strict: true,
        },
      },
    }),
  }).catch(() => null);

  if (!response || !response.ok) {
    return {
      ...fallbackDraft(input),
      notes: "OpenAI request failed. Returned local fallback.",
    };
  }

  const payload = (await response.json().catch(() => null)) as unknown;
  const parsed = parseAppraisalResponse(payload);
  if (!parsed) {
    return {
      ...fallbackDraft(input),
      notes: "OpenAI response parsing failed. Returned local fallback.",
    };
  }

  return sanitize(parsed, input);
}
