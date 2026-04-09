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
      <div className="flex w-full flex-col items-center gap-5 lg:flex-row lg:justify-center lg:gap-6">
        {showLogo && storeLogoUrl ? (
          <div className="flex h-[56px] w-[116px] items-center justify-center sm:h-[64px] sm:w-[132px] lg:h-[72px] lg:w-[150px]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={storeLogoUrl}
              alt={`${storeName} logo`}
              className="max-h-full w-full object-contain"
              onError={() => setShowLogo(false)}
            />
          </div>
        ) : null}

        <h1 className="max-w-[16ch] font-serif text-[36px] font-semibold leading-[1.1] tracking-tight text-[var(--text-primary)] sm:text-[48px] sm:leading-[1.08] lg:max-w-none lg:text-[56px] lg:leading-[1.07]">
          {storeName}
        </h1>
      </div>

      <p className="mt-5 max-w-[48ch] text-[16px] font-light italic leading-8 text-[var(--text-secondary)] sm:mt-6">
        Every piece in the collection, at your fingertips.
      </p>
    </section>
  );
}
