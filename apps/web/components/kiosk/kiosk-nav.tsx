"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Lock, LockOpen } from "lucide-react";
import StaffPinModal from "@/components/kiosk/staff-pin-modal";
import { cn } from "@/lib/utils";

interface KioskNavProps {
  initialUnlocked: boolean;
}

const INACTIVITY_MS = 10 * 60 * 1000;

const LINKS = [
  { href: "/concierge", label: "Concierge", requiresStaff: false },
  { href: "/inventory", label: "Inventory", requiresStaff: true },
  { href: "/intake", label: "Intake", requiresStaff: true },
] as const;

function isStaffPath(pathname: string): boolean {
  return pathname === "/inventory" || pathname.startsWith("/inventory/") || pathname === "/intake" || pathname.startsWith("/intake/");
}

function isLinkActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function KioskNav({ initialUnlocked }: KioskNavProps) {
  const router = useRouter();
  const pathname = usePathname() ?? "/concierge";

  const [unlocked, setUnlocked] = useState(initialUnlocked);
  const [showPinModal, setShowPinModal] = useState(false);
  const [inactivityTimer, setInactivityTimer] = useState<number | null>(null);

  useEffect(() => {
    setUnlocked(initialUnlocked);
  }, [initialUnlocked]);

  const clearTimer = useCallback(() => {
    if (inactivityTimer) {
      window.clearTimeout(inactivityTimer);
      setInactivityTimer(null);
    }
  }, [inactivityTimer]);

  const handleLock = useCallback(async () => {
    clearTimer();
    try {
      await fetch("/api/auth/lock", { method: "POST" });
    } catch {
      // Keep UI responsive even if network fails.
    }

    setUnlocked(false);
    setShowPinModal(false);

    if (isStaffPath(pathname)) {
      router.push("/concierge");
      return;
    }

    router.refresh();
  }, [clearTimer, pathname, router]);

  const resetTimer = useCallback(() => {
    if (!unlocked) return;

    if (inactivityTimer) {
      window.clearTimeout(inactivityTimer);
    }

    const timer = window.setTimeout(() => {
      void handleLock();
    }, INACTIVITY_MS);

    setInactivityTimer(timer);
  }, [handleLock, inactivityTimer, unlocked]);

  useEffect(() => {
    if (!unlocked) {
      clearTimer();
      return;
    }

    const events: Array<keyof WindowEventMap> = [
      "pointermove",
      "pointerdown",
      "keydown",
      "touchstart",
      "scroll",
    ];

    const onActivity = () => {
      resetTimer();
    };

    events.forEach((eventName) => {
      window.addEventListener(eventName, onActivity, { passive: true });
    });

    resetTimer();

    return () => {
      events.forEach((eventName) => {
        window.removeEventListener(eventName, onActivity);
      });
      clearTimer();
    };
  }, [clearTimer, resetTimer, unlocked]);

  const handleUnlockSuccess = useCallback(() => {
    setUnlocked(true);
    setShowPinModal(false);
    router.refresh();
  }, [router]);

  return (
    <>
      <div className="mx-auto mt-2 flex w-full max-w-6xl flex-wrap items-center gap-2 px-4 opacity-95 transition-all duration-200 sm:px-6 lg:px-8">
        {LINKS.filter((link) => (link.requiresStaff ? unlocked : true)).map((link) => {
          const active = isLinkActive(pathname, link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "inline-flex min-h-9 items-center rounded-full border px-3 py-1.5 text-sm font-medium leading-5 transition-colors",
                active
                  ? "border-primary/50 bg-primary/10 text-foreground"
                  : "border-border/20 bg-background/35 text-muted-foreground hover:border-primary/30 hover:bg-primary/10 hover:text-foreground"
              )}
            >
              {link.label}
            </Link>
          );
        })}

        <button
          type="button"
          onClick={unlocked ? () => void handleLock() : () => setShowPinModal(true)}
          aria-label={unlocked ? "Lock staff mode" : "Unlock staff mode"}
          className="ml-auto rounded-full p-1.5 transition-colors hover:bg-accent"
        >
          {unlocked ? (
            <LockOpen className="h-4 w-4 text-primary" />
          ) : (
            <Lock className="h-4 w-4 text-muted-foreground" />
          )}
        </button>
      </div>

      {showPinModal ? (
        <StaffPinModal
          onSuccess={handleUnlockSuccess}
          onDismiss={() => setShowPinModal(false)}
        />
      ) : null}
    </>
  );
}
