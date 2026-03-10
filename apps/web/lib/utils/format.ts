/** Converts raw inches to rug display format: 96 -> "8'", 102 -> "8'6\"" */
export function inchesToFeet(inches: number): string {
  const feet = Math.floor(inches / 12);
  const rem = inches % 12;
  return rem > 0 ? `${feet}'${rem}"` : `${feet}'`;
}

/** Formats a rug's width x length from raw inches: (96, 120) -> "8' × 10'" */
export function formatRugSize(
  widthIn: number | null | undefined,
  lengthIn: number | null | undefined
): string {
  if (typeof widthIn !== "number" || typeof lengthIn !== "number") return "";
  return `${inchesToFeet(widthIn)} × ${inchesToFeet(lengthIn)}`;
}
