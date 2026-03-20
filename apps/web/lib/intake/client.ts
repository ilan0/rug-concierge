import type {
  IntakeCreateRequest,
  IntakeCreateResponse,
  IntakeDuplicateImageResponse,
} from "@/lib/types/intake";
import { mapApiErrorToFriendlyMessage } from "@/lib/ui/error-messages";

function toWholeNumber(value: number): string {
  return String(Math.floor(value));
}

function parseExistingRug(
  payload: { existing_rug?: unknown } | null,
  code: string | null
): IntakeDuplicateImageResponse["existing_rug"] | null {
  if (code !== "DUPLICATE_IMAGE") return null;
  if (!payload || typeof payload.existing_rug !== "object" || !payload.existing_rug) {
    return null;
  }

  const row = payload.existing_rug as Record<string, unknown>;
  const id = typeof row.id === "string" ? row.id.trim() : "";
  if (!id) return null;

  return {
    id,
    label: typeof row.label === "string" ? row.label : null,
  };
}

export class IntakeRequestError extends Error {
  status: number;
  code: string | null;
  existingRug: IntakeDuplicateImageResponse["existing_rug"] | null;

  constructor(input: {
    message: string;
    status: number;
    code: string | null;
    existingRug: IntakeDuplicateImageResponse["existing_rug"] | null;
  }) {
    super(input.message);
    this.name = "IntakeRequestError";
    this.status = input.status;
    this.code = input.code;
    this.existingRug = input.existingRug;
  }
}

export async function createInventoryIntake(
  input: IntakeCreateRequest
): Promise<IntakeCreateResponse> {
  const formData = new FormData();
  formData.set("tenant_id", input.tenant_id);
  if (typeof input.stock_id === "string" && input.stock_id.trim().length > 0) {
    formData.set("stock_id", input.stock_id.trim());
  }
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
    const code =
      payload && typeof payload.code === "string" ? payload.code : null;
    const existingRug = parseExistingRug(
      payload as { existing_rug?: unknown } | null,
      code
    );

    throw new IntakeRequestError({
      message: mapApiErrorToFriendlyMessage({
        status: response.status,
        code,
        rawMessage:
          payload && typeof payload.error === "string"
            ? payload.error
            : null,
        context: "intake",
        fallbackMessage: "Unable to save intake right now.",
      }),
      status: response.status,
      code,
      existingRug,
    });
  }

  if (!payload || typeof payload !== "object" || !("rug" in payload)) {
    throw new Error("Invalid intake response payload.");
  }

  return payload as IntakeCreateResponse;
}
