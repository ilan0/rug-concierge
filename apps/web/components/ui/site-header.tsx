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

const FALLBACK_STORE_NAME = "Rug Gallery Concierge";

export function SiteHeader({ storeName, storeLogoUrl, showBranding = true }: SiteHeaderProps) {
  const router = useRouter();
  const displayStoreName = storeName.trim().length > 0 ? storeName : FALLBACK_STORE_NAME;
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
      <header className="fixed left-0 right-0 top-0 z-50 border-b border-[var(--divider-subtle)] bg-[color-mix(in_srgb,var(--surface)_94%,transparent)] backdrop-blur-[1px] sm:backdrop-blur-[3px]">
        <div className="mx-auto flex h-14 max-w-[940px] items-center justify-between px-3 sm:h-16 sm:px-5">
          {showBranding ? (
            <div className="flex min-w-0 items-center gap-3">
              <StoreLogoMark
                storeName={displayStoreName}
                logoUrl={storeLogoUrl}
                containerClassName="h-11 w-11 rounded-xl"
                imageClassName="p-1.5"
                fallbackTextClassName="text-sm tracking-[0.07em]"
              />
              <div className="min-w-0">
                <span className="block max-w-[clamp(9rem,56vw,25rem)] truncate text-[17px] font-medium leading-tight tracking-[-0.01em] text-[var(--text-primary)] sm:text-[19px]">
                  {displayStoreName}
                </span>
              </div>
            </div>
          ) : (
            <div />
          )}

          <button
            type="button"
            onClick={() => setShowPinModal(true)}
            aria-label="Unlock staff mode"
            className="relative flex h-11 min-w-11 items-center justify-center rounded-full border border-[var(--border-primary)] bg-[color:rgba(252,250,247,0.96)] text-[var(--text-secondary)] shadow-[0_2px_8px_rgba(46,34,24,0.06)] transition hover:border-[var(--border-interactive)] hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-gold)] focus-visible:ring-offset-2"
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
