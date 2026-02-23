import type { AppraisalDraftResponse } from "@/lib/types/appraisal";
import type { AppraisalInput } from "@/lib/types/appraisal";
import { getUiRole } from "@/lib/ui/role-session";

export async function generateAppraisalDraftClient(
  appraisalContext: AppraisalInput
): Promise<AppraisalDraftResponse> {
  const activeRole = getUiRole() ?? "store_staff";
  const response = await fetch("/api/appraisal/generate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      role: activeRole,
      appraisal_context: appraisalContext,
    }),
  });

  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    const errorMessage =
      payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error: unknown }).error)
        : "Unable to generate appraisal draft.";
    throw new Error(errorMessage);
  }

  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid appraisal response payload.");
  }

  return payload as AppraisalDraftResponse;
}

export function appraisalToPlainText(result: AppraisalDraftResponse): string {
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
