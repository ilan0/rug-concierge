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
        fallbackTextClassName="text-[27px] tracking-[0.1em]"
      />
      <div className="mt-5 max-w-[24ch] lg:mt-0 lg:max-w-[26ch]">
        <h1 className="overflow-hidden text-balance font-serif text-[clamp(2.1rem,8vw,3rem)] leading-[1.03] tracking-tight text-[var(--text-primary)] [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] sm:text-[clamp(2.35rem,5.8vw,3.35rem)] lg:text-[clamp(2.6rem,3.4vw,4rem)]">
          {displayStoreName}
        </h1>
      </div>
    </section>
  );
}
