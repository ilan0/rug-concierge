type ErrorMappingContext =
  | "chat"
  | "intake"
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

  if (status === 429 || code === "TOO_MANY_REQUESTS") {
    return "You've sent a lot of messages. Please wait a moment before continuing.";
  }

  if (status === 401 || code === "UNAUTHORIZED") {
    return "Staff access is locked. Tap the lock icon and enter the store passcode.";
  }

  if (status === 403 || code === "FORBIDDEN") {
    return "This action requires staff access.";
  }

  if (status === 409 || code === "DUPLICATE_IMAGE") {
    return "Duplicate detected: this exact photo already exists in your inventory.";
  }

  if (status === 400 || code === "BAD_REQUEST") {
    if (
      includesAny(raw, [
        "tenant context",
        "store domain",
        "tenant not found",
        "tenant resolution",
      ])
    ) {
      return "Store routing failed for this domain. Please verify the store URL and try again.";
    }
    if (includesAny(raw, ["please send a message", "message"])) {
      return "Please type a message before sending.";
    }
    if (includesAny(raw, ["constraints"])) {
      return "One or more filters are invalid. Please review your inputs and try again.";
    }
    if (includesAny(raw, ["role mismatch", "role and user_role"])) {
      return "Role selection is unavailable in this build. Use the lock icon to unlock staff mode.";
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
    if (input.context === "intake") {
      return "Intake save failed right now. Please retry in a moment.";
    }
  }

  return input.fallbackMessage;
}
