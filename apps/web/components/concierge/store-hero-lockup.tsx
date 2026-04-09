"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

type StoreHeroLockupProps = {
  storeName: string;
  storeLogoUrl: string | null;
  className?: string;
};

export function StoreHeroLockup({ storeName, storeLogoUrl, className }: StoreHeroLockupProps) {
  const [showLogo, setShowLogo] = useState(Boolean(storeLogoUrl));

  useEffect(() => {
    setShowLogo(Boolean(storeLogoUrl));
  }, [storeLogoUrl]);

  return (
    <section className={cn("flex flex-col items-center text-center", className)}>
      <div className="flex w-full flex-col items-center gap-4 lg:flex-row lg:justify-center lg:gap-5">
        {showLogo && storeLogoUrl ? (
          <div className="flex h-[72px] w-[120px] items-center justify-center rounded-2xl border border-border/55 bg-card/88 px-3 py-2 shadow-[0_8px_20px_rgba(36,20,5,0.08)] backdrop-blur-sm sm:h-[78px] sm:w-[132px] lg:h-[84px] lg:w-[146px]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={storeLogoUrl}
              alt={`${storeName} logo`}
              className="max-h-full w-full object-contain"
              onError={() => setShowLogo(false)}
            />
          </div>
        ) : null}

        <h1 className="max-w-[16ch] font-serif text-[36px] font-semibold leading-[1.05] tracking-tight text-foreground sm:text-[42px] lg:max-w-none lg:text-[46px]">
          {storeName}
        </h1>
      </div>

      <p className="mt-4 max-w-[44ch] text-[15px] font-light italic leading-relaxed text-muted-foreground sm:mt-5 sm:text-[16px]">
        Every piece in the collection, at your fingertips.
      </p>
    </section>
  );
}
