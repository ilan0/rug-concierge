import type {
  AppraisalDraftResponse,
  AppraisalGenerateResponse,
  AppraisalInput,
  AppraisalSourceType,
  AppraisalStatus,
} from "@/lib/types/appraisal";
import type {
  AppraisalDraftListResult,
  AppraisalDraftSaveResult,
  AppraisalRugLookupResult,
} from "@/lib/types/appraisal-ui";
import { getUiRole } from "@/lib/ui/role-session";
import { mapApiErrorToFriendlyMessage } from "@/lib/ui/error-messages";

function resolveRole(): string {
  return getUiRole() ?? "store_staff";
}

async function parseJsonSafe(response: Response): Promise<unknown> {
  return (await response.json().catch(() => null)) as unknown;
}

function throwFriendlyError(payload: unknown, response: Response, fallback: string): never {
  const payloadError =
    payload && typeof payload === "object" && "error" in payload
      ? String((payload as { error: unknown }).error)
      : null;
  const payloadCode =
    payload && typeof payload === "object" && "code" in payload
      ? String((payload as { code: unknown }).code)
      : null;
  const errorMessage = mapApiErrorToFriendlyMessage({
    status: response.status,
    code: payloadCode,
    rawMessage: payloadError,
    context: "appraisal",
    fallbackMessage: fallback,
  });
  throw new Error(errorMessage);
}

export async function generateAppraisalDraftClient(
  appraisalContext: AppraisalInput,
  options: {
    tenantId: string;
    sourceType: AppraisalSourceType;
    rugId?: string | null;
    appraisalId?: string | null;
    persist?: boolean;
  }
): Promise<AppraisalGenerateResponse> {
  const response = await fetch("/api/appraisal/generate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      role: resolveRole(),
      tenant_id: options.tenantId,
      source_type: options.sourceType,
      rug_id: options.rugId ?? null,
      appraisal_id: options.appraisalId ?? null,
      persist: options.persist ?? true,
      appraisal_context: appraisalContext,
    }),
  });

  const payload = await parseJsonSafe(response);
  if (!response.ok) {
    throwFriendlyError(payload, response, "Unable to generate appraisal draft.");
  }

  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid appraisal response payload.");
  }

  return payload as AppraisalGenerateResponse;
}

export async function listAppraisalRugsClient(input: {
  tenantId: string;
  q?: string;
  status?: string;
  limit?: number;
}): Promise<AppraisalRugLookupResult> {
  const search = new URLSearchParams({
    tenant_id: input.tenantId,
    role: resolveRole(),
  });
  if (input.q?.trim()) search.set("q", input.q.trim());
  if (input.status?.trim()) search.set("status", input.status.trim());
  if (typeof input.limit === "number" && Number.isFinite(input.limit)) {
    search.set("limit", String(Math.floor(input.limit)));
  }

  const response = await fetch(`/api/appraisal/rugs?${search.toString()}`);
  const payload = await parseJsonSafe(response);
  if (!response.ok) {
    throwFriendlyError(payload, response, "Unable to load inventory rugs.");
  }
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid appraisal rug lookup payload.");
  }
  return payload as AppraisalRugLookupResult;
}

export async function listAppraisalDraftsClient(input: {
  tenantId: string;
  status?: AppraisalStatus | null;
  limit?: number;
}): Promise<AppraisalDraftListResult> {
  const search = new URLSearchParams({
    tenant_id: input.tenantId,
    role: resolveRole(),
  });
  if (input.status) search.set("status", input.status);
  if (typeof input.limit === "number" && Number.isFinite(input.limit)) {
    search.set("limit", String(Math.floor(input.limit)));
  }

  const response = await fetch(`/api/appraisal/drafts?${search.toString()}`);
  const payload = await parseJsonSafe(response);
  if (!response.ok) {
    throwFriendlyError(payload, response, "Unable to load saved appraisal drafts.");
  }
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid appraisal drafts payload.");
  }
  return payload as AppraisalDraftListResult;
}

export async function saveAppraisalDraftClient(input: {
  tenantId: string;
  sourceType: AppraisalSourceType;
  appraisalId?: string | null;
  rugId?: string | null;
  status: AppraisalStatus;
  appraisalContext: AppraisalInput;
  draftPayload: AppraisalGenerateResponse | AppraisalDraftResponse | Record<string, unknown>;
  draftText?: string | null;
  finalText?: string | null;
}): Promise<AppraisalDraftSaveResult> {
  const response = await fetch("/api/appraisal/drafts", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      role: resolveRole(),
      tenant_id: input.tenantId,
      source_type: input.sourceType,
      appraisal_id: input.appraisalId ?? null,
      rug_id: input.rugId ?? null,
      status: input.status,
      appraisal_context: input.appraisalContext,
      draft_payload: input.draftPayload,
      draft_text: input.draftText ?? null,
      final_text: input.finalText ?? null,
    }),
  });

  const payload = await parseJsonSafe(response);
  if (!response.ok) {
    throwFriendlyError(payload, response, "Unable to save appraisal draft.");
  }
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid appraisal save response payload.");
  }
  return payload as AppraisalDraftSaveResult;
}

export function appraisalToPlainText(result: AppraisalGenerateResponse | AppraisalDraftResponse): string {
  if (result.mode === "cannot_generate" || !result.draft) {
    return [
      "APPRAISAL DRAFT STATUS",
      "---------------------",
      result.assistant_message,
      result.notes ? `Note: ${result.notes}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  const { draft } = result;
  const header = draft.header;
  return [
    "APPRAISAL DRAFT",
    "===============",
    "",
    "HEADER",
    "------",
    `Customer: ${header.customer_name ?? "-"}`,
    `Contact: ${header.customer_contact ?? "-"}`,
    `Date: ${header.appraisal_date ?? "-"}`,
    `Rug Label: ${header.rug_label ?? "-"}`,
    `Rug Size: ${header.rug_size_text ?? "-"}`,
    "",
    "DESCRIPTION",
    "-----------",
    ...draft.description_paragraphs.map((paragraph) => `- ${paragraph}`),
    "",
    "VALUE",
    "-----",
    `${draft.value_section.label}: ${
      typeof draft.value_section.amount === "number"
        ? `${draft.value_section.amount} ${draft.value_section.currency ?? ""}`.trim()
        : "-"
    }`,
    draft.value_section.statement,
    "",
    "DISCLAIMERS",
    "-----------",
    ...draft.disclaimers.map((line) => `- ${line}`),
    "",
    "MISSING FIELDS",
    "--------------",
    ...(result.missing_fields.length > 0
      ? result.missing_fields.map((field) => `- ${field}`)
      : ["- none"]),
    "",
    result.notes ? `Note: ${result.notes}` : "",
    `Generated: ${draft.metadata.generated_at}`,
    `Schema: ${draft.metadata.schema_version}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export async function copyTextToClipboard(value: string): Promise<void> {
  await navigator.clipboard.writeText(value);
}

export function downloadTextFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

