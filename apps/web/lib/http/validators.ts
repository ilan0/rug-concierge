export function readTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function readUserMessage(input: {
  user_message?: unknown;
  message?: unknown;
}): string {
  const preferred = readTrimmedString(input.user_message);
  if (preferred) return preferred;
  return readTrimmedString(input.message);
}
