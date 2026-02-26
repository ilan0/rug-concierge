import {
  getMaxOutputTokens,
  normalizeText,
  postOpenAiResponses,
  shouldRetryAfterAttempt,
  withRetryInstruction,
} from "@/lib/ai/response-quality";
import { getRecommendationPromptBundle } from "@/lib/ai/prompt-library";
import type {
  AppraisalDraftResponse,
  AppraisalInput,
} from "@/lib/types/appraisal";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-4.1-nano";
const MAX_ASSISTANT_MESSAGE_CHARS = 320;
const MAX_NOTES_CHARS = 220;
const MAX_HEADER_FIELD_CHARS = 160;
const MAX_PARAGRAPH_CHARS = 600;
const MAX_VALUE_STATEMENT_CHARS = 320;
const MAX_DISCLAIMER_CHARS = 260;
const MAX_MISSING_FIELD_CHARS = 60;
const MAX_DESCRIPTION_PARAGRAPHS = 6;
const MAX_DISCLAIMERS = 5;
const RETRY_SYSTEM_INSTRUCTION =
  "Retry and return one complete JSON object that matches the schema exactly. Keep language concise and finish all sentences.";

const APPRAISAL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["mode", "assistant_message", "draft", "missing_fields", "notes"],
  properties: {
    mode: { type: "string", enum: ["appraisal_draft", "cannot_generate"] },
    assistant_message: {
      type: "string",
      minLength: 1,
      maxLength: MAX_ASSISTANT_MESSAGE_CHARS,
    },
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
            customer_name: { type: ["string", "null"], maxLength: MAX_HEADER_FIELD_CHARS },
            customer_contact: {
              type: ["string", "null"],
              maxLength: MAX_HEADER_FIELD_CHARS,
            },
            appraisal_date: { type: ["string", "null"], maxLength: MAX_HEADER_FIELD_CHARS },
            rug_label: { type: ["string", "null"], maxLength: MAX_HEADER_FIELD_CHARS },
            rug_size_text: { type: ["string", "null"], maxLength: MAX_HEADER_FIELD_CHARS },
          },
        },
        description_paragraphs: {
          type: "array",
          maxItems: MAX_DESCRIPTION_PARAGRAPHS,
          items: { type: "string", minLength: 1, maxLength: MAX_PARAGRAPH_CHARS },
        },
        value_section: {
          type: "object",
          additionalProperties: false,
          required: ["label", "amount", "currency", "statement"],
          properties: {
            label: { type: "string", const: "Appraised Value" },
            amount: { type: ["number", "null"] },
            currency: { type: ["string", "null"], maxLength: 12 },
            statement: {
              type: "string",
              minLength: 1,
              maxLength: MAX_VALUE_STATEMENT_CHARS,
            },
          },
        },
        disclaimers: {
          type: "array",
          maxItems: MAX_DISCLAIMERS,
          items: { type: "string", minLength: 1, maxLength: MAX_DISCLAIMER_CHARS },
        },
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
    missing_fields: {
      type: "array",
      maxItems: 8,
      items: { type: "string", minLength: 1, maxLength: MAX_MISSING_FIELD_CHARS },
    },
    notes: { type: ["string", "null"], maxLength: MAX_NOTES_CHARS },
  },
} as const;

export type AppraisalAiTrace = {
  called: boolean;
  model: string;
  request_payload: unknown | null;
  response_status: number | null;
  response_payload: unknown | null;
  parsed_response: AppraisalDraftResponse | null;
  fallback_reason: string | null;
  error: string | null;
  incomplete_detected: boolean;
  retry_attempted: boolean;
  retry_succeeded: boolean;
  text_postprocess_applied: boolean;
};

export type AppraisalRequestPayloadPreview = {
  model: string | null;
  message_groups: number;
  schema_name: string | null;
  schema_strict: boolean | null;
  max_output_tokens: number | null;
};

export type AppraisalResponsePayloadPreview = {
  has_output_text: boolean;
  output_items: number;
  content_blocks: number;
  has_error: boolean;
  error_type: string | null;
};

export function toAppraisalRequestPayloadPreview(
  payload: unknown
): AppraisalRequestPayloadPreview | null {
  if (!payload || typeof payload !== "object") return null;
  const data = payload as Record<string, unknown>;
  const inputBlocks = Array.isArray(data.input) ? data.input : [];
  const text =
    data.text && typeof data.text === "object"
      ? (data.text as Record<string, unknown>)
      : null;
  const format =
    text?.format && typeof text.format === "object"
      ? (text.format as Record<string, unknown>)
      : null;

  return {
    model: typeof data.model === "string" ? data.model : null,
    message_groups: inputBlocks.length,
    schema_name: typeof format?.name === "string" ? format.name : null,
    schema_strict: typeof format?.strict === "boolean" ? format.strict : null,
    max_output_tokens:
      typeof data.max_output_tokens === "number" ? data.max_output_tokens : null,
  };
}

export function toAppraisalResponsePayloadPreview(
  payload: unknown
): AppraisalResponsePayloadPreview | null {
  if (!payload || typeof payload !== "object") return null;
  const data = payload as Record<string, unknown>;
  const output = Array.isArray(data.output) ? data.output : [];
  let contentBlocks = 0;

  for (const outputItem of output) {
    if (!outputItem || typeof outputItem !== "object") continue;
    const item = outputItem as Record<string, unknown>;
    if (!Array.isArray(item.content)) continue;
    contentBlocks += item.content.length;
  }

  const error =
    data.error && typeof data.error === "object"
      ? (data.error as Record<string, unknown>)
      : null;

  return {
    has_output_text:
      typeof data.output_text === "string" && data.output_text.trim().length > 0,
    output_items: output.length,
    content_blocks: contentBlocks,
    has_error: Boolean(error),
    error_type: typeof error?.type === "string" ? error.type : null,
  };
}

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

function isWithinMax(value: string, maxChars: number): boolean {
  return normalizeText(value).length > 0 && normalizeText(value).length <= maxChars;
}

function isNullableWithinMax(value: unknown, maxChars: number): boolean {
  if (value === null) return true;
  return typeof value === "string" && normalizeText(value).length <= maxChars;
}

function isAppraisalDraftResponse(value: unknown): value is AppraisalDraftResponse {
  if (!value || typeof value !== "object") return false;
  const data = value as Record<string, unknown>;
  if (data.mode !== "appraisal_draft" && data.mode !== "cannot_generate") {
    return false;
  }

  if (
    typeof data.assistant_message !== "string" ||
    !isWithinMax(data.assistant_message, MAX_ASSISTANT_MESSAGE_CHARS)
  ) {
    return false;
  }
  if (!Array.isArray(data.missing_fields)) return false;
  if (
    !data.missing_fields.every(
      (item) => typeof item === "string" && isWithinMax(item, MAX_MISSING_FIELD_CHARS)
    )
  ) {
    return false;
  }
  if (!(typeof data.notes === "string" || data.notes === null)) return false;
  if (typeof data.notes === "string" && normalizeText(data.notes).length > MAX_NOTES_CHARS) {
    return false;
  }

  if (data.draft === null) return true;
  if (!data.draft || typeof data.draft !== "object") return false;

  const draft = data.draft as Record<string, unknown>;
  if (!draft.header || typeof draft.header !== "object") return false;
  const header = draft.header as Record<string, unknown>;
  if (!isNullableWithinMax(header.customer_name, MAX_HEADER_FIELD_CHARS)) return false;
  if (!isNullableWithinMax(header.customer_contact, MAX_HEADER_FIELD_CHARS)) return false;
  if (!isNullableWithinMax(header.appraisal_date, MAX_HEADER_FIELD_CHARS)) return false;
  if (!isNullableWithinMax(header.rug_label, MAX_HEADER_FIELD_CHARS)) return false;
  if (!isNullableWithinMax(header.rug_size_text, MAX_HEADER_FIELD_CHARS)) return false;

  if (!Array.isArray(draft.description_paragraphs)) return false;
  if (draft.description_paragraphs.length > MAX_DESCRIPTION_PARAGRAPHS) return false;
  if (
    !draft.description_paragraphs.every(
      (item) => typeof item === "string" && isWithinMax(item, MAX_PARAGRAPH_CHARS)
    )
  ) {
    return false;
  }

  if (!draft.value_section || typeof draft.value_section !== "object") return false;
  const valueSection = draft.value_section as Record<string, unknown>;
  if (valueSection.label !== "Appraised Value") return false;
  if (!(typeof valueSection.amount === "number" || valueSection.amount === null)) {
    return false;
  }
  if (!isNullableWithinMax(valueSection.currency, 12)) return false;
  if (
    typeof valueSection.statement !== "string" ||
    !isWithinMax(valueSection.statement, MAX_VALUE_STATEMENT_CHARS)
  ) {
    return false;
  }

  if (!Array.isArray(draft.disclaimers)) return false;
  if (draft.disclaimers.length > MAX_DISCLAIMERS) return false;
  if (
    !draft.disclaimers.every(
      (item) => typeof item === "string" && isWithinMax(item, MAX_DISCLAIMER_CHARS)
    )
  ) {
    return false;
  }

  if (!draft.metadata || typeof draft.metadata !== "object") return false;
  const metadata = draft.metadata as Record<string, unknown>;
  if (typeof metadata.generated_at !== "string") return false;
  if (metadata.schema_version !== "appraisal_draft_v1") return false;

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
      assistant_message: normalizeText(response.assistant_message),
      notes: response.notes ? normalizeText(response.notes) : null,
      draft: null,
    };
  }

  if (!response.draft) {
    return fallbackDraft(input);
  }

  return {
    ...response,
    assistant_message: normalizeText(response.assistant_message),
    notes: response.notes ? normalizeText(response.notes) : null,
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
  input: AppraisalInput,
  trace?: AppraisalAiTrace
): Promise<AppraisalDraftResponse> {
  if (input.status === "finalized") {
    if (trace) {
      trace.called = false;
      trace.model = OPENAI_MODEL;
      trace.request_payload = null;
      trace.response_status = null;
      trace.response_payload = null;
      trace.parsed_response = null;
      trace.fallback_reason = "Finalized appraisal status";
      trace.error = null;
      trace.incomplete_detected = false;
      trace.retry_attempted = false;
      trace.retry_succeeded = false;
      trace.text_postprocess_applied = false;
    }
    return fallbackDraft(input);
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    if (trace) {
      trace.called = false;
      trace.model = OPENAI_MODEL;
      trace.request_payload = null;
      trace.response_status = null;
      trace.response_payload = null;
      trace.parsed_response = null;
      trace.fallback_reason = "Missing OPENAI_API_KEY";
      trace.error = null;
      trace.incomplete_detected = false;
      trace.retry_attempted = false;
      trace.retry_succeeded = false;
      trace.text_postprocess_applied = false;
    }
    return {
      ...fallbackDraft(input),
      notes: "Missing OPENAI_API_KEY. Returned local fallback.",
    };
  }

  const requestPayload = {
    // Use prompt docs as source of truth; keep this endpoint-specific rule as additive.
    model: OPENAI_MODEL,
    max_output_tokens: getMaxOutputTokens("appraisal"),
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: getRecommendationPromptBundle().appraisal,
          },
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
          {
            type: "input_text",
            text:
              "Keep prose concise, complete, and professional. Do not return unfinished fragments.",
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
  };

  if (trace) {
    trace.called = true;
    trace.model = OPENAI_MODEL;
    trace.request_payload = requestPayload;
    trace.response_status = null;
    trace.response_payload = null;
    trace.parsed_response = null;
    trace.fallback_reason = null;
    trace.error = null;
    trace.incomplete_detected = false;
    trace.retry_attempted = false;
    trace.retry_succeeded = false;
    trace.text_postprocess_applied = false;
  }

  const firstAttempt = await postOpenAiResponses({
    url: OPENAI_RESPONSES_URL,
    apiKey,
    requestPayload,
  });

  if (trace) {
    trace.response_status = firstAttempt.response_status;
    trace.response_payload = firstAttempt.response_payload;
    trace.incomplete_detected = firstAttempt.incomplete_detected;
  }

  if (!firstAttempt.ok) {
    if (trace) {
      trace.fallback_reason = "OpenAI request failed";
      trace.error = firstAttempt.error;
    }
    return {
      ...fallbackDraft(input),
      notes: "OpenAI request failed. Returned local fallback.",
    };
  }

  let parsed = parseAppraisalResponse(firstAttempt.response_payload);
  const shouldRetry = shouldRetryAfterAttempt({
    attempt: firstAttempt,
    parseSucceeded: Boolean(parsed),
    alreadyRetried: false,
  });

  if (shouldRetry) {
    if (trace) trace.retry_attempted = true;

    const retryPayload = withRetryInstruction(
      requestPayload,
      RETRY_SYSTEM_INSTRUCTION
    );
    const retryAttempt = await postOpenAiResponses({
      url: OPENAI_RESPONSES_URL,
      apiKey,
      requestPayload: retryPayload,
    });

    if (trace) {
      trace.response_status = retryAttempt.response_status;
      trace.response_payload = retryAttempt.response_payload;
      trace.incomplete_detected =
        firstAttempt.incomplete_detected || retryAttempt.incomplete_detected;
    }

    if (retryAttempt.ok) {
      parsed = parseAppraisalResponse(retryAttempt.response_payload);
      if (trace) trace.retry_succeeded = Boolean(parsed);
    }
  }

  if (!parsed) {
    if (trace) {
      trace.fallback_reason = "OpenAI response parsing failed";
      trace.error = "OpenAI response parsing failed";
      trace.parsed_response = null;
    }
    return {
      ...fallbackDraft(input),
      notes: "OpenAI response parsing failed. Returned local fallback.",
    };
  }

  const sanitized = sanitize(parsed, input);
  if (trace) {
    trace.parsed_response = sanitized;
    trace.fallback_reason = null;
    trace.error = null;
  }

  return sanitized;
}
