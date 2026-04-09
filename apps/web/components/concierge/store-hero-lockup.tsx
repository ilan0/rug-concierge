"use client";

import { StoreLogoMark } from "@/components/ui/store-logo-mark";
import { cn } from "@/lib/utils";

type StoreHeroLockupProps = {
  storeName: string;
  storeLogoUrl: string | null;
  className?: string;
};

export function StoreHeroLockup({ storeName, storeLogoUrl, className }: StoreHeroLockupProps) {
  return (
    <section className={cn("flex flex-col items-center text-center", className)}>
      <StoreLogoMark
        storeName={storeName}
        logoUrl={storeLogoUrl}
        containerClassName="h-[88px] w-[88px] rounded-2xl"
        fallbackTextClassName="text-[28px] tracking-[0.1em]"
      />
      <div className="mt-5 max-w-[22ch]">
        <h1 className="overflow-hidden text-balance font-serif text-[42px] leading-[44px] tracking-tight text-[var(--text-primary)] [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] sm:text-[48px] sm:leading-[52px] lg:text-[60px] lg:leading-[62px] xl:text-[72px] xl:leading-[74px]">
          {storeName}
        </h1>
      </div>
    </section>
  );
}
