"use client";

import { usePathname } from "next/navigation";
import KioskNav from "@/components/kiosk/kiosk-nav";

type LayoutHeaderProps = {
  initialUnlocked: boolean;
};

export function LayoutHeader({ initialUnlocked }: LayoutHeaderProps) {
  const pathname = usePathname();

  if (pathname === "/concierge") {
    return null;
  }

  return (
    <header
      aria-label="Store header"
      className="sticky top-0 z-40 border-b border-border/35 bg-background/92 shadow-[0_1px_0_rgba(60,39,15,0.05)] backdrop-blur supports-[backdrop-filter]:bg-background/80"
    >
      <KioskNav initialUnlocked={initialUnlocked} />
    </header>
  );
}
