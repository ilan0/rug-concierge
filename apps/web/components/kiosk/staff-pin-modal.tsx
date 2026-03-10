"use client";

import { useEffect, useMemo, useState } from "react";
import { Delete } from "lucide-react";
import { cn } from "@/lib/utils";

interface StaffPinModalProps {
  onSuccess: () => void;
  onDismiss: () => void;
}

const MAX_DIGITS = 4;
const CLIENT_ATTEMPT_WARNING_THRESHOLD = 3;

export default function StaffPinModal({ onSuccess, onDismiss }: StaffPinModalProps) {
  const [pin, setPin] = useState("");
  const [attempts, setAttempts] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showRateLimitWarning, setShowRateLimitWarning] = useState(false);
  const [shake, setShake] = useState(false);

  const showAttemptWarning =
    showRateLimitWarning || attempts >= CLIENT_ATTEMPT_WARNING_THRESHOLD;

  const keypadDigits = useMemo(() => ["1", "2", "3", "4", "5", "6", "7", "8", "9"], []);

  useEffect(() => {
    if (!shake) return;
    const timer = window.setTimeout(() => setShake(false), 350);
    return () => window.clearTimeout(timer);
  }, [shake]);

  useEffect(() => {
    if (pin.length !== MAX_DIGITS || isSubmitting) return;

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
          setShowRateLimitWarning(false);
          onSuccess();
          return;
        }

        if (response.status === 429) {
          setPin("");
          setShowRateLimitWarning(true);
          setShake(true);
          return;
        }

        if (response.status === 401) {
          setPin("");
          setAttempts((prev) => prev + 1);
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
  }, [pin, isSubmitting, onSuccess]);

  const appendDigit = (digit: string) => {
    if (isSubmitting || pin.length >= MAX_DIGITS) return;
    setShowRateLimitWarning(false);
    setPin((prev) => `${prev}${digit}`);
  };

  const removeDigit = () => {
    if (isSubmitting) return;
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
        className="mx-4 w-full max-w-xs rounded-2xl bg-card p-8 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label="Staff Access"
        onClick={(event) => event.stopPropagation()}
      >
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

        {showAttemptWarning ? (
          <p className="mt-3 text-center text-xs text-amber-700">
            Too many attempts - please wait a moment
          </p>
        ) : null}

        <div className="mt-6 grid grid-cols-3 justify-items-center gap-3">
          {keypadDigits.map((digit) => (
            <button
              key={digit}
              type="button"
              className="h-14 w-14 rounded-full text-lg font-medium text-foreground transition-all hover:bg-accent active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => appendDigit(digit)}
              disabled={isSubmitting}
            >
              {digit}
            </button>
          ))}

          <span className="h-14 w-14" aria-hidden="true" />

          <button
            type="button"
            className="h-14 w-14 rounded-full text-lg font-medium text-foreground transition-all hover:bg-accent active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => appendDigit("0")}
            disabled={isSubmitting}
          >
            0
          </button>

          <button
            type="button"
            className="flex h-14 w-14 items-center justify-center rounded-full text-foreground transition-all hover:bg-accent active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={removeDigit}
            disabled={isSubmitting || pin.length === 0}
            aria-label="Delete"
          >
            <Delete className="size-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
