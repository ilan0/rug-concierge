type ErrorMappingContext =
  | "chat"
  | "appraisal"
  | "intake"
  | "debug_trace"
  | "generic";

type ApiErrorMappingInput = {
  status: number;
  code?: string | null;
  rawMessage?: string | null;
  context: ErrorMappingContext;
  fallbackMessage: string;
};

function includesAny(value: string, patterns: string[]): boolean {
  return patterns.some((pattern) => value.includes(pattern));
}

export function mapApiErrorToFriendlyMessage(
  input: ApiErrorMappingInput
): string {
  const status = input.status;
  const code = (input.code ?? "").toUpperCase();
  const raw = (input.rawMessage ?? "").toLowerCase();

  if (status === 401 || code === "UNAUTHORIZED") {
    return "Pilot access is locked. Go to Home, enter access code, and try again.";
  }

  if (status === 403 || code === "FORBIDDEN") {
    return "This action is not available for your current role. Switch to an allowed role and try again.";
  }

  if (status === 400 || code === "BAD_REQUEST") {
    if (
      includesAny(raw, [
        "tenant_id is required",
        "inventory-backed",
        "tenant context",
      ])
    ) {
      return "Please select a tenant before requesting inventory recommendations.";
    }
    if (includesAny(raw, ["please send a message", "message"])) {
      return "Please type a message before sending.";
    }
    if (includesAny(raw, ["constraints"])) {
      return "One or more filters are invalid. Please review your inputs and try again.";
    }
    if (includesAny(raw, ["role mismatch", "role and user_role"])) {
      return "Your role information is out of sync. Re-select your role from Home and try again.";
    }
    if (input.context === "appraisal") {
      return "Please review appraisal input fields and try again.";
    }
    if (input.context === "intake") {
      if (
        includesAny(raw, [
          "image",
          "width",
          "length",
          "intake_label",
        ])
      ) {
        return "Please complete the required intake fields and try again.";
      }
      return "Please review intake inputs and try again.";
    }
    return "Your request needs a quick fix before it can be processed. Please review and try again.";
  }

  if (status >= 500) {
    if (input.context === "chat") {
      return "The concierge service is temporarily unavailable. Please try again in a moment.";
    }
    if (input.context === "appraisal") {
      return "Appraisal generation is temporarily unavailable. Please try again shortly.";
    }
    if (input.context === "intake") {
      return "Intake save failed right now. Please retry in a moment.";
    }
  }

  if (input.context === "debug_trace") {
    return "Debug trace is unavailable for this turn. Try sending a new message with debug mode enabled.";
  }

  return input.fallbackMessage;
}
