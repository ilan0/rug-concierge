"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";
import StaffPinModal from "@/components/kiosk/staff-pin-modal";
import {
  readStaffPinLockedUntilMs,
  secondsUntilStaffPinUnlock,
} from "@/lib/auth/staff-lockout";

type SiteHeaderProps = {
  storeName: string;
  storeLogoUrl: string | null;
};

export function SiteHeader({ storeName, storeLogoUrl }: SiteHeaderProps) {
  const router = useRouter();
  const [showLogo, setShowLogo] = useState(Boolean(storeLogoUrl));
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
      <header className="fixed left-0 right-0 top-0 z-50 border-b border-border/35 bg-background/88 backdrop-blur-sm">
        <div className="mx-auto flex h-12 max-w-5xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-2.5">
            {showLogo && storeLogoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={storeLogoUrl}
                alt={`${storeName} logo`}
                className="h-7 w-auto flex-shrink-0 object-contain"
                onError={() => setShowLogo(false)}
              />
            ) : null}
            <span className="truncate font-serif text-[15px] font-semibold tracking-tight text-foreground">
              {storeName}
            </span>
          </div>

          <button
            type="button"
            onClick={() => setShowPinModal(true)}
            aria-label="Unlock staff mode"
            className="relative flex size-8 items-center justify-center rounded-full"
          >
            <Lock className="size-4 text-muted-foreground/35" />
            {pinCooldownSeconds > 0 ? (
              <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-amber-500 ring-2 ring-background" />
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
