"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Lock, LockOpen } from "lucide-react";
import StaffPinModal from "@/components/kiosk/staff-pin-modal";
import {
  readStaffPinLockedUntilMs,
  secondsUntilStaffPinUnlock,
} from "@/lib/auth/staff-lockout";
import { cn } from "@/lib/utils";

interface KioskNavProps {
  initialUnlocked: boolean;
}

const INACTIVITY_MS = 10 * 60 * 1000;

const STAFF_LINKS = [
  { href: "/inventory", label: "Inventory" },
  { href: "/intake", label: "Intake" },
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
  const [pinCooldownSeconds, setPinCooldownSeconds] = useState(() => {
    const lockedUntil = readStaffPinLockedUntilMs();
    if (!lockedUntil) return 0;
    return secondsUntilStaffPinUnlock(lockedUntil);
  });
  const inactivityTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    // Ensure every route transition lands at the top of the new page.
    window.requestAnimationFrame(() => {
      window.scrollTo(0, 0);
    });
  }, [pathname]);

  const syncPinCooldown = useCallback(() => {
    const lockedUntil = readStaffPinLockedUntilMs();
    if (!lockedUntil) {
      setPinCooldownSeconds(0);
      return;
    }
    setPinCooldownSeconds(secondsUntilStaffPinUnlock(lockedUntil));
  }, []);

  useEffect(() => {
    const timer = window.setInterval(syncPinCooldown, 1000);
    window.addEventListener("focus", syncPinCooldown);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", syncPinCooldown);
    };
  }, [syncPinCooldown]);

  const clearTimer = useCallback(() => {
    if (inactivityTimerRef.current !== null) {
      window.clearTimeout(inactivityTimerRef.current);
      inactivityTimerRef.current = null;
    }
  }, []);

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

    if (inactivityTimerRef.current !== null) {
      window.clearTimeout(inactivityTimerRef.current);
    }

    const timer = window.setTimeout(() => {
      void handleLock();
    }, INACTIVITY_MS);

    inactivityTimerRef.current = timer;
  }, [handleLock, unlocked]);

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

  const visibleLinks = unlocked ? STAFF_LINKS : [];

  return (
    <>
      <nav
        aria-label="Primary kiosk navigation"
        className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-2 px-4 py-2 opacity-95 transition-all duration-200 sm:px-6 lg:px-8"
      >
        {visibleLinks.map((link) => {
          const active = isLinkActive(pathname, link.href);
          const className = cn(
            "inline-flex min-h-9 items-center rounded-full border px-3 py-1.5 text-sm font-medium leading-5 transition-colors",
            active
              ? "border-primary bg-primary text-primary-foreground shadow-sm"
              : "border-border/55 bg-background/75 text-foreground/75 hover:border-primary/45 hover:bg-primary/10 hover:text-foreground"
          );

          return (
            <a
              key={link.href}
              href={link.href}
              className={className}
            >
              {link.label}
            </a>
          );
        })}

        <button
          type="button"
          onClick={unlocked ? () => void handleLock() : () => setShowPinModal(true)}
          aria-label={unlocked ? "Lock staff mode" : "Unlock staff mode"}
          className="relative ml-auto flex size-11 items-center justify-center rounded-full transition-colors hover:bg-accent"
        >
          {unlocked ? (
            <LockOpen className="h-4 w-4 text-primary" />
          ) : (
            <Lock className="h-4 w-4 text-muted-foreground" />
          )}
          {!unlocked && pinCooldownSeconds > 0 ? (
            <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-amber-500 ring-2 ring-background" />
          ) : null}
        </button>
      </nav>

      {showPinModal ? (
        <StaffPinModal
          onSuccess={handleUnlockSuccess}
          onDismiss={() => setShowPinModal(false)}
        />
      ) : null}
    </>
  );
}
