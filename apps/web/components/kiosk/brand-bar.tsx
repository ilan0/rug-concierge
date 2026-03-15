"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

type BrandBarProps = {
  storeName: string;
  logoMarkUrl: string | null;
};

export function BrandBar({ storeName, logoMarkUrl }: BrandBarProps) {
  const [showLogo, setShowLogo] = useState(Boolean(logoMarkUrl));

  useEffect(() => {
    setShowLogo(Boolean(logoMarkUrl));
  }, [logoMarkUrl]);

  return (
    <section className="mx-auto mt-2 w-full max-w-6xl px-4 sm:px-6 lg:px-8">
      <div className="rounded-xl border border-border/55 bg-card/80 px-3 py-2 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-card/70 sm:px-4">
        <div className="flex min-h-11 items-center gap-3">
          {showLogo && logoMarkUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoMarkUrl}
              alt={`${storeName} mark`}
              className={cn(
                "h-9 w-9 shrink-0 rounded-md border border-border/60 bg-white/80 object-contain p-0.5",
                "sm:h-10 sm:w-10"
              )}
              onError={() => setShowLogo(false)}
            />
          ) : null}
          <p className="min-w-0 truncate font-serif text-base font-semibold tracking-[0.01em] text-foreground sm:text-lg">
            {storeName}
          </p>
        </div>
      </div>
    </section>
  );
}
