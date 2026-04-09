"use client";

import { StoreLogoMark } from "@/components/ui/store-logo-mark";
import { cn } from "@/lib/utils";

type StoreHeroLockupProps = {
  storeName: string;
  storeLogoUrl: string | null;
  className?: string;
};

const FALLBACK_STORE_NAME = "Rug Gallery Concierge";

export function StoreHeroLockup({ storeName, storeLogoUrl, className }: StoreHeroLockupProps) {
  const displayStoreName = storeName.trim().length > 0 ? storeName : FALLBACK_STORE_NAME;
  return (
    <section className={cn("flex flex-col items-center text-center lg:flex-row lg:items-center lg:gap-5 lg:text-left", className)}>
      <StoreLogoMark
        storeName={displayStoreName}
        logoUrl={storeLogoUrl}
        containerClassName="h-[88px] w-[88px] rounded-2xl"
        imageClassName="p-2"
        fallbackTextClassName="text-[27px] tracking-[0.1em]"
      />
      <div className="mt-5 max-w-[24ch] lg:mt-0 lg:max-w-[27ch]">
        <h1 className="overflow-hidden text-balance font-serif text-[clamp(2.1rem,8vw,2.95rem)] leading-[1.02] tracking-[-0.014em] text-[var(--text-primary)] [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] sm:text-[clamp(2.3rem,5.8vw,3.25rem)] lg:text-[clamp(2.5rem,3.2vw,3.85rem)]">
          {displayStoreName}
        </h1>
      </div>
    </section>
  );
}
