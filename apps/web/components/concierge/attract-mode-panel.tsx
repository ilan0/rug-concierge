"use client";

import { StoreHeroLockup } from "@/components/concierge/store-hero-lockup";
import { cn } from "@/lib/utils";

type AttractModePanelProps = {
  storeName: string;
  storeLogoUrl: string | null;
  backgroundImageUrls: string[];
  onStart: () => void;
};

function AttractBackdrop(input: { imageUrls: string[] }) {
  const images = input.imageUrls.slice(0, 3);
  if (images.length === 0) {
    return (
      <div
        aria-hidden="true"
        className="absolute inset-0 rounded-[34px] bg-[linear-gradient(145deg,rgba(233,214,165,0.28),rgba(243,236,227,0.72)),radial-gradient(circle_at_16%_18%,rgba(201,161,74,0.2),transparent_42%),radial-gradient(circle_at_82%_76%,rgba(46,34,24,0.08),transparent_48%)]"
      />
    );
  }

  return (
    <div aria-hidden="true" className="absolute inset-0 overflow-hidden rounded-[34px]">
      {images.map((src, index) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={`${src}-${index}`}
          src={src}
          alt=""
          className={cn(
            "absolute inset-0 h-full w-full object-cover opacity-45",
            index === 1 && "translate-x-[12%] translate-y-[4%] scale-[1.08]",
            index === 2 && "-translate-x-[10%] -translate-y-[2%] scale-[1.12]"
          )}
          style={{
            filter: "saturate(0.55) blur(1.5px)",
            mixBlendMode: index === 0 ? "normal" : "multiply",
          }}
          loading="eager"
          decoding="async"
        />
      ))}
      <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(248,244,238,0.28),rgba(248,244,238,0.52),rgba(248,244,238,0.86))]" />
      <div className="absolute inset-0 bg-[color:rgba(248,244,238,0.35)]" />
    </div>
  );
}

export function AttractModePanel({
  storeName,
  storeLogoUrl,
  backgroundImageUrls,
  onStart,
}: AttractModePanelProps) {
  return (
    <section className="flex min-h-[calc(100dvh-56px)] items-center justify-center px-3 py-7 sm:min-h-[calc(100dvh-64px)] sm:px-8 sm:py-8">
      <div className="relative h-[min(540px,calc(100dvh-180px))] w-[min(820px,calc(100vw-80px))] overflow-hidden rounded-[34px] border border-[var(--border-primary)] bg-[color:rgba(252,250,247,0.92)] shadow-[0_16px_32px_rgba(46,34,24,0.09)]">
        <AttractBackdrop imageUrls={backgroundImageUrls} />
        <div className="relative z-[1] flex h-full flex-col items-center justify-center px-5 py-9 text-center sm:px-10">
          <StoreHeroLockup storeName={storeName} storeLogoUrl={storeLogoUrl} />
          <h2 className="mt-6 font-serif text-[40px] leading-[42px] tracking-tight text-[var(--text-primary)] sm:text-[56px] sm:leading-[58px] lg:text-[64px] lg:leading-[66px]">
            Rug Concierge
          </h2>
          <p className="mt-4 max-w-[38ch] text-[18px] leading-7 text-[var(--text-secondary)] sm:text-[21px] sm:leading-8">
            Tap to begin a guided rug discovery session
          </p>
          <button
            type="button"
            onClick={onStart}
            className="mt-9 h-14 min-h-11 w-[240px] rounded-[28px] bg-[var(--accent-gold)] text-[18px] font-medium leading-5 text-[var(--text-primary)] transition hover:bg-[var(--accent-gold-hover)] active:scale-[0.995] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-gold)] focus-visible:ring-offset-2 sm:h-[68px] sm:w-[320px] sm:rounded-[34px] sm:text-[24px] sm:leading-7 lg:h-[60px] lg:w-[280px] lg:rounded-[30px] lg:text-[20px] lg:leading-6"
          >
            Tap to Start
          </button>
        </div>
      </div>
    </section>
  );
}
