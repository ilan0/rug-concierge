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
    <section className={cn("flex flex-col items-center text-center", className)}>
      <StoreLogoMark
        storeName={displayStoreName}
        logoUrl={storeLogoUrl}
        containerClassName="h-[68px] w-[68px] rounded-[14px] sm:h-[84px] sm:w-[84px] sm:rounded-[18px]"
        imageClassName="p-2 sm:p-2.5"
        fallbackTextClassName="text-[23px] tracking-[0.08em] sm:text-[27px]"
      />
      <h1 className="mt-3 max-w-[30ch] overflow-hidden text-balance font-serif text-[clamp(1.5rem,3.1vw,2.15rem)] leading-[1.12] tracking-[-0.012em] text-[var(--text-primary)] [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]">
        {displayStoreName}
      </h1>
    </section>
  );
}
