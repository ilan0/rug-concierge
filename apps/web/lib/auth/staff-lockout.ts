export const STAFF_PIN_LOCKOUT_STORAGE_KEY = "staff_pin_locked_until_ms";

export function readStaffPinLockedUntilMs(nowMs = Date.now()): number | null {
  if (typeof window === "undefined") return null;

  const raw = window.localStorage.getItem(STAFF_PIN_LOCKOUT_STORAGE_KEY);
  if (!raw) return null;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= nowMs) {
    window.localStorage.removeItem(STAFF_PIN_LOCKOUT_STORAGE_KEY);
    return null;
  }

  return parsed;
}

export function writeStaffPinLockedUntilMs(lockedUntilMs: number): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    STAFF_PIN_LOCKOUT_STORAGE_KEY,
    String(Math.floor(lockedUntilMs))
  );
}

export function clearStaffPinLockedUntilMs(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STAFF_PIN_LOCKOUT_STORAGE_KEY);
}

export function secondsUntilStaffPinUnlock(
  lockedUntilMs: number,
  nowMs = Date.now()
): number {
  return Math.max(0, Math.ceil((lockedUntilMs - nowMs) / 1000));
}

export function formatStaffPinCooldown(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  const remaining = safe % 60;
  return `${minutes}:${String(remaining).padStart(2, "0")}`;
}
