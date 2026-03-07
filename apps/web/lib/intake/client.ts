import type { UiRole } from "@/lib/types/chat-ui";
import type { IntakeCreateRequest, IntakeCreateResponse } from "@/lib/types/intake";
import { mapApiErrorToFriendlyMessage } from "@/lib/ui/error-messages";

function toWholeNumber(value: number): string {
  return String(Math.floor(value));
}

export async function createInventoryIntake(
  input: IntakeCreateRequest
): Promise<IntakeCreateResponse> {
  const formData = new FormData();
  formData.set("role", input.role);
  formData.set("tenant_id", input.tenant_id);
  formData.set("intake_label", input.intake_label);
  formData.set("width_ft", toWholeNumber(input.width_ft));
  formData.set("width_in", toWholeNumber(input.width_in));
  formData.set("length_ft", toWholeNumber(input.length_ft));
  formData.set("length_in", toWholeNumber(input.length_in));
  formData.set("image", input.image);

  const response = await fetch("/api/inventory/intake", {
    method: "POST",
    body: formData,
  });

  const payload = (await response.json().catch(() => null)) as
    | {
        error?: unknown;
        code?: unknown;
        rug?: unknown;
      }
    | null;

  if (!response.ok) {
    throw new Error(
      mapApiErrorToFriendlyMessage({
        status: response.status,
        code:
          payload && typeof payload.code === "string"
            ? payload.code
            : null,
        rawMessage:
          payload && typeof payload.error === "string"
            ? payload.error
            : null,
        context: "intake",
        fallbackMessage: "Unable to save intake right now.",
      })
    );
  }

  if (!payload || typeof payload !== "object" || !("rug" in payload)) {
    throw new Error("Invalid intake response payload.");
  }

  return payload as IntakeCreateResponse;
}

export function resolveIntakeRole(role: UiRole | null): UiRole {
  if (role === "store_staff" || role === "developer") return role;
  return "store_staff";
}
