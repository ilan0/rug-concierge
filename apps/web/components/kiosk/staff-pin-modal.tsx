"use client";

import { useEffect, useMemo, useState } from "react";
import { Delete, X } from "lucide-react";
import {
  clearStaffPinLockedUntilMs,
  formatStaffPinCooldown,
  readStaffPinLockedUntilMs,
  secondsUntilStaffPinUnlock,
  writeStaffPinLockedUntilMs,
} from "@/lib/auth/staff-lockout";
import { cn } from "@/lib/utils";

interface StaffPinModalProps {
  onSuccess: () => void;
  onDismiss: () => void;
}

const MAX_DIGITS = 4;
const PASSCODE_LOCKOUT_FALLBACK_SECONDS = 5 * 60;

export default function StaffPinModal({ onSuccess, onDismiss }: StaffPinModalProps) {
  const [pin, setPin] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lockedUntilMs, setLockedUntilMs] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [shake, setShake] = useState(false);

  const cooldownSeconds = lockedUntilMs
    ? secondsUntilStaffPinUnlock(lockedUntilMs, nowMs)
    : 0;
  const isCooldownActive = cooldownSeconds > 0;

  const keypadDigits = useMemo(() => ["1", "2", "3", "4", "5", "6", "7", "8", "9"], []);

  useEffect(() => {
    if (!shake) return;
    const timer = window.setTimeout(() => setShake(false), 350);
    return () => window.clearTimeout(timer);
  }, [shake]);

  useEffect(() => {
    const lockedUntil = readStaffPinLockedUntilMs();
    if (lockedUntil) {
      setLockedUntilMs(lockedUntil);
      setNowMs(Date.now());
    }
  }, []);

  useEffect(() => {
    if (!lockedUntilMs) return;

    const syncLockout = () => {
      const next = readStaffPinLockedUntilMs();
      setNowMs(Date.now());
      setLockedUntilMs(next);
    };

    syncLockout();
    const interval = window.setInterval(syncLockout, 1000);
    window.addEventListener("focus", syncLockout);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", syncLockout);
    };
  }, [lockedUntilMs]);

  useEffect(() => {
    // Intentionally exclude `isSubmitting` from effect deps so in-flight requests
    // are not canceled by cleanup when `setIsSubmitting(true)` runs.
    if (pin.length !== MAX_DIGITS || isSubmitting || isCooldownActive) return;

    let active = true;

    const submitPin = async () => {
      setIsSubmitting(true);
      try {
        const response = await fetch("/api/auth/passcode", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ passcode: pin }),
        });

        if (!active) return;

        if (response.ok) {
          setPin("");
          clearStaffPinLockedUntilMs();
          setLockedUntilMs(null);
          onSuccess();
          return;
        }

        if (response.status === 429) {
          const payload = (await response.json().catch(() => null)) as
            | { retry_after_seconds?: unknown }
            | null;
          const payloadRetryAfter =
            payload && typeof payload.retry_after_seconds === "number"
              ? Math.max(1, Math.ceil(payload.retry_after_seconds))
              : null;
          const headerRetryAfter = Number.parseInt(
            response.headers.get("Retry-After") ?? "",
            10
          );
          const retryAfterSeconds =
            payloadRetryAfter ??
            (Number.isFinite(headerRetryAfter) && headerRetryAfter > 0
              ? headerRetryAfter
              : null) ??
            PASSCODE_LOCKOUT_FALLBACK_SECONDS;

          const nextLockedUntil = Date.now() + retryAfterSeconds * 1000;
          writeStaffPinLockedUntilMs(nextLockedUntil);
          setLockedUntilMs(nextLockedUntil);
          setNowMs(Date.now());
          setPin("");
          setShake(true);
          return;
        }

        if (response.status === 401) {
          setPin("");
          setShake(true);
          return;
        }

        setPin("");
        setShake(true);
      } catch {
        if (!active) return;
        setPin("");
        setShake(true);
      } finally {
        if (active) {
          setIsSubmitting(false);
        }
      }
    };

    void submitPin();

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin, isCooldownActive, onSuccess]);

  const appendDigit = (digit: string) => {
    if (isSubmitting || isCooldownActive || pin.length >= MAX_DIGITS) return;
    setPin((prev) => `${prev}${digit}`);
  };

  const removeDigit = () => {
    if (isSubmitting || isCooldownActive) return;
    setPin((prev) => prev.slice(0, -1));
  };

  const onBackdropClick = () => {
    if (isSubmitting) return;
    onDismiss();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onBackdropClick}
      role="presentation"
    >
      <div
        className="relative mx-4 w-full max-w-xs rounded-2xl bg-card p-8 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label="Staff Access"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          aria-label="Close staff access"
          className="absolute right-3 top-3 rounded-full p-1 text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          onClick={onDismiss}
          disabled={isSubmitting}
        >
          <X className="size-4" />
        </button>
        <h2 className="font-serif text-xl font-semibold text-foreground">Staff Access</h2>
        <p className="mt-1 text-sm text-muted-foreground">Enter store passcode</p>

        <div className={cn("mt-6 flex items-center justify-center gap-3", shake && "animate-shake")}> 
          {Array.from({ length: MAX_DIGITS }).map((_, index) => {
            const filled = index < pin.length;
            return (
              <span
                key={index}
                className={cn(
                  "size-3 rounded-full transition-colors",
                  filled ? "bg-primary" : "border-2 border-border bg-transparent"
                )}
              />
            );
          })}
        </div>

        {isCooldownActive ? (
          <p className="mt-3 text-center text-xs text-amber-700">
            Too many attempts. Try again in {formatStaffPinCooldown(cooldownSeconds)}
          </p>
        ) : null}

        <div className="mt-6 grid grid-cols-3 justify-items-center gap-3">
          {keypadDigits.map((digit) => (
            <button
              key={digit}
              type="button"
              className="h-14 w-14 rounded-full text-lg font-medium text-foreground transition-all hover:bg-accent active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => appendDigit(digit)}
              disabled={isSubmitting || isCooldownActive}
            >
              {digit}
            </button>
          ))}

          <span className="h-14 w-14" aria-hidden="true" />

          <button
            type="button"
            className="h-14 w-14 rounded-full text-lg font-medium text-foreground transition-all hover:bg-accent active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => appendDigit("0")}
            disabled={isSubmitting || isCooldownActive}
          >
            0
          </button>

          <button
            type="button"
            className="flex h-14 w-14 items-center justify-center rounded-full text-foreground transition-all hover:bg-accent active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={removeDigit}
            disabled={isSubmitting || isCooldownActive || pin.length === 0}
            aria-label="Delete"
          >
            <Delete className="size-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
