export type DimensionField = "width_ft" | "width_in" | "length_ft" | "length_in";

export type ValidatedDimensions = {
  widthFt: number;
  widthIn: number;
  lengthFt: number;
  lengthIn: number;
  widthTotalIn: number;
  lengthTotalIn: number;
};

export const INTAKE_LABEL_MAX_CHARS = 120;
export const INTAKE_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/avif",
]);

export function normalizeIntakeLabel(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function validateIntakeLabel(
  value: unknown,
  maxChars = INTAKE_LABEL_MAX_CHARS
): { ok: true; value: string } | { ok: false; error: string } {
  const normalized = normalizeIntakeLabel(value);
  if (!normalized) {
    return { ok: false, error: "intake_label is required." };
  }
  if (normalized.length > maxChars) {
    return {
      ok: false,
      error: `intake_label must be ${maxChars} characters or fewer.`,
    };
  }
  return { ok: true, value: normalized };
}

function isDigitsOnly(value: string): boolean {
  return /^\d+$/.test(value);
}

export function parseDimensionField(
  value: unknown,
  field: DimensionField
): number | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized || !isDigitsOnly(normalized)) return null;
  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isFinite(parsed)) return null;

  if (field.endsWith("_in")) {
    return parsed >= 0 && parsed <= 11 ? parsed : null;
  }

  return parsed >= 0 && parsed <= 99 ? parsed : null;
}

export function validateDimensionTuple(input: {
  widthFt: number | null;
  widthIn: number | null;
  lengthFt: number | null;
  lengthIn: number | null;
}): { ok: true; value: ValidatedDimensions } | { ok: false; error: string } {
  const { widthFt, widthIn, lengthFt, lengthIn } = input;
  if (
    widthFt === null ||
    widthIn === null ||
    lengthFt === null ||
    lengthIn === null
  ) {
    return {
      ok: false,
      error: "width_ft/width_in/length_ft/length_in are required whole numbers.",
    };
  }

  const widthTotalIn = widthFt * 12 + widthIn;
  const lengthTotalIn = lengthFt * 12 + lengthIn;
  if (widthTotalIn <= 0 || lengthTotalIn <= 0) {
    return {
      ok: false,
      error: "width and length must be greater than zero.",
    };
  }

  return {
    ok: true,
    value: {
      widthFt,
      widthIn,
      lengthFt,
      lengthIn,
      widthTotalIn,
      lengthTotalIn,
    },
  };
}

export function validateImageFile(
  value: unknown,
  maxBytes = INTAKE_IMAGE_MAX_BYTES
): { ok: true; file: File } | { ok: false; error: string } {
  if (!(value instanceof File)) {
    return { ok: false, error: "image is required." };
  }
  if (!ALLOWED_IMAGE_TYPES.has(value.type.toLowerCase())) {
    return {
      ok: false,
      error:
        "image must be one of: jpeg, jpg, png, webp, heic, heif, or avif.",
    };
  }
  if (!Number.isFinite(value.size) || value.size <= 0) {
    return { ok: false, error: "image must not be empty." };
  }
  if (value.size > maxBytes) {
    return { ok: false, error: "image must be 10MB or smaller." };
  }
  return { ok: true, file: value };
}
