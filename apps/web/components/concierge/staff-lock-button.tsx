"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";
import StaffPinModal from "@/components/kiosk/staff-pin-modal";
import {
  readStaffPinLockedUntilMs,
  secondsUntilStaffPinUnlock,
} from "@/lib/auth/staff-lockout";

export function StaffLockButton() {
  const router = useRouter();
  const [showPinModal, setShowPinModal] = useState(false);
  const [pinCooldownSeconds, setPinCooldownSeconds] = useState(() => {
    const lockedUntil = readStaffPinLockedUntilMs();
    if (!lockedUntil) return 0;
    return secondsUntilStaffPinUnlock(lockedUntil);
  });

  useEffect(() => {
    const syncCooldown = () => {
      const lockedUntil = readStaffPinLockedUntilMs();
      setPinCooldownSeconds(lockedUntil ? secondsUntilStaffPinUnlock(lockedUntil) : 0);
    };
    const timer = window.setInterval(syncCooldown, 1000);
    window.addEventListener("focus", syncCooldown);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", syncCooldown);
    };
  }, []);

  const handleUnlockSuccess = useCallback(() => {
    setShowPinModal(false);
    if (typeof window !== "undefined") {
      window.location.assign("/inventory");
      return;
    }
    router.replace("/inventory");
  }, [router]);

  return (
    <>
      <button
        type="button"
        onClick={() => setShowPinModal(true)}
        aria-label="Unlock staff mode"
        data-staff-lock-button="true"
        className="fixed z-50 flex h-11 w-11 items-center justify-center rounded-full border text-white opacity-[0.28] transition-opacity duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-gold)] focus-visible:ring-offset-2 hover:opacity-[0.55]"
        style={{
          top: "max(12px, env(safe-area-inset-top))",
          right: "max(12px, env(safe-area-inset-right))",
          borderColor: "rgba(255,255,255,0.32)",
          backgroundColor: "rgba(34,22,12,0.36)",
        }}
      >
        <Lock className="h-6 w-6" />
        {pinCooldownSeconds > 0 ? (
          <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-[var(--accent-gold)]" />
        ) : null}
      </button>

      {showPinModal ? (
        <StaffPinModal
          onSuccess={handleUnlockSuccess}
          onDismiss={() => setShowPinModal(false)}
        />
      ) : null}
    </>
  );
}
