"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";
import StaffPinModal from "@/components/kiosk/staff-pin-modal";
import { StoreLogoMark } from "@/components/ui/store-logo-mark";
import {
  readStaffPinLockedUntilMs,
  secondsUntilStaffPinUnlock,
} from "@/lib/auth/staff-lockout";

type SiteHeaderProps = {
  storeName: string;
  storeLogoUrl: string | null;
  showBranding?: boolean;
};

export function SiteHeader({ storeName, storeLogoUrl, showBranding = true }: SiteHeaderProps) {
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
      <header className="fixed left-0 right-0 top-0 z-50 border-b border-[var(--divider-subtle)] bg-[color-mix(in_srgb,var(--surface)_96%,transparent)] backdrop-blur-0 sm:backdrop-blur-[2px]">
        <div className="mx-auto flex h-14 max-w-[920px] items-center justify-between px-3 sm:h-16 sm:px-5">
          {showBranding ? (
            <div className="flex min-w-0 items-center gap-3">
              <StoreLogoMark
                storeName={storeName}
                logoUrl={storeLogoUrl}
                containerClassName="h-11 w-11 rounded-xl"
                fallbackTextClassName="text-sm"
              />
              <span className="max-w-[180px] truncate text-[18px] font-medium leading-[1.2] text-[var(--text-primary)] sm:max-w-[320px] sm:text-[20px]">
                {storeName}
              </span>
            </div>
          ) : (
            <div />
          )}

          <button
            type="button"
            onClick={() => setShowPinModal(true)}
            aria-label="Unlock staff mode"
            className="relative flex h-11 min-w-11 items-center justify-center rounded-full border border-transparent text-[var(--text-secondary)] transition hover:border-[var(--border-interactive)] hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-gold)] focus-visible:ring-offset-2"
          >
            <Lock className="size-5" />
            {pinCooldownSeconds > 0 ? (
              <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-[var(--accent-gold)]" />
            ) : null}
          </button>
        </div>
      </header>

      {showPinModal ? (
        <StaffPinModal
          onSuccess={handleUnlockSuccess}
          onDismiss={() => setShowPinModal(false)}
        />
      ) : null}
    </>
  );
}
