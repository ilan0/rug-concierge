import type { HardConstraints } from "@/lib/types/recommendation";

export const DEFAULT_TOLERANCE_IN = 2;

export type SizeBounds = {
  minWidthIn: number;
  maxWidthIn: number;
  minLengthIn: number;
  maxLengthIn: number;
  toleranceIn: number;
};

export function getSizeBounds(size: HardConstraints["size"]): SizeBounds | null {
  if (!size) return null;

  const toleranceIn = size.toleranceIn ?? DEFAULT_TOLERANCE_IN;
  return {
    minWidthIn: size.widthIn - toleranceIn,
    maxWidthIn: size.widthIn + toleranceIn,
    minLengthIn: size.lengthIn - toleranceIn,
    maxLengthIn: size.lengthIn + toleranceIn,
    toleranceIn,
  };
}

export function matchesSizeWithBounds(
  widthTotalIn: number,
  lengthTotalIn: number,
  bounds: SizeBounds
): boolean {
  const directMatch =
    widthTotalIn >= bounds.minWidthIn &&
    widthTotalIn <= bounds.maxWidthIn &&
    lengthTotalIn >= bounds.minLengthIn &&
    lengthTotalIn <= bounds.maxLengthIn;

  const rotatedMatch =
    widthTotalIn >= bounds.minLengthIn &&
    widthTotalIn <= bounds.maxLengthIn &&
    lengthTotalIn >= bounds.minWidthIn &&
    lengthTotalIn <= bounds.maxWidthIn;

  return directMatch || rotatedMatch;
}

