"use client";

import { StoreLogoMark } from "@/components/ui/store-logo-mark";

type SiteHeaderProps = {
  storeName: string;
  storeLogoUrl: string | null;
  showBranding?: boolean;
};

const FALLBACK_STORE_NAME = "Rug Gallery Concierge";

export function SiteHeader({ storeName, storeLogoUrl, showBranding = true }: SiteHeaderProps) {
  const displayStoreName = storeName.trim().length > 0 ? storeName : FALLBACK_STORE_NAME;

  return (
    <header className="fixed left-0 right-0 top-0 z-40 border-b border-[var(--divider-subtle)] bg-[color-mix(in_srgb,var(--active-surface)_95%,transparent)] backdrop-blur-[0px] sm:backdrop-blur-[2px]">
      <div className="mx-auto flex h-14 max-w-[980px] items-center justify-between px-3 sm:h-16 sm:px-5">
        {showBranding ? (
          <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
            <StoreLogoMark
              storeName={displayStoreName}
              logoUrl={storeLogoUrl}
              containerClassName="h-10 w-10 rounded-xl border border-[var(--active-border)] bg-[color:color-mix(in_srgb,var(--active-surface-2)_86%,white)]"
              imageClassName="p-1.5"
              fallbackTextClassName="text-sm tracking-[0.07em]"
            />
            <div className="min-w-0">
              <span className="block max-w-[clamp(12rem,58vw,28ch)] truncate text-[16px] font-medium leading-tight tracking-[-0.01em] text-[var(--active-text)] sm:text-[17px]">
                {displayStoreName}
              </span>
            </div>
          </div>
        ) : (
          <div />
        )}

        <div aria-hidden="true" className="h-11 w-11" />
      </div>
    </header>
  );
}
