import type { HardConstraints } from "@/lib/types/recommendation";

export const DEFAULT_TOLERANCE_IN = 2;

export type SizeBounds = {
  minWidthIn: number;
  maxWidthIn: number;
  minLengthIn: number;
  maxLengthIn: number;
  toleranceIn: number;
};

export type SizeWindow = {
  minWidthIn?: number;
  maxWidthIn?: number;
  minLengthIn?: number;
  maxLengthIn?: number;
};

function isWithinWindow(
  value: number,
  minValue?: number,
  maxValue?: number
): boolean {
  if (typeof minValue === "number" && value < minValue) return false;
  if (typeof maxValue === "number" && value > maxValue) return false;
  return true;
}

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

export function matchesSizeWithWindow(
  widthTotalIn: number,
  lengthTotalIn: number,
  window: SizeWindow
): boolean {
  const directMatch =
    isWithinWindow(widthTotalIn, window.minWidthIn, window.maxWidthIn) &&
    isWithinWindow(lengthTotalIn, window.minLengthIn, window.maxLengthIn);

  const rotatedMatch =
    isWithinWindow(widthTotalIn, window.minLengthIn, window.maxLengthIn) &&
    isWithinWindow(lengthTotalIn, window.minWidthIn, window.maxWidthIn);

  return directMatch || rotatedMatch;
}
