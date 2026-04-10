"use client";

import { useEffect, useRef, useState } from "react";
import { StoreHeroLockup } from "@/components/concierge/store-hero-lockup";
import { cn } from "@/lib/utils";

type AttractModePanelProps = {
  storeName: string;
  storeLogoUrl: string | null;
  backgroundImageUrls: string[];
  onStart: () => void;
};

function AttractCanvasBackdrop(input: { imageUrls: string[] }) {
  const images = input.imageUrls.slice(0, 3);
  if (images.length === 0) {
    return (
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[linear-gradient(136deg,rgba(62,46,31,0.34),rgba(40,29,18,0.46)),radial-gradient(circle_at_17%_20%,rgba(201,161,74,0.2),transparent_38%),radial-gradient(circle_at_84%_78%,rgba(233,214,165,0.16),transparent_40%),linear-gradient(172deg,#4a3928_0%,#3d2e21_52%,#2f2319_100%)]"
      />
    );
  }

  return (
    <div aria-hidden="true" className="absolute inset-0 overflow-hidden">
      {images.map((src, index) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={`${src}-${index}`}
          src={src}
          alt=""
          className={cn(
            "absolute inset-0 h-full w-full object-cover",
            index === 1 && "translate-x-[11%] translate-y-[2%] scale-[1.07]",
            index === 2 && "-translate-x-[8%] -translate-y-[2%] scale-[1.1]"
          )}
          style={{
            filter: "saturate(0.55) blur(2px)",
            opacity: index === 0 ? 0.86 : 0.32,
            mixBlendMode: index === 0 ? "normal" : "multiply",
          }}
          loading="eager"
          decoding="async"
        />
      ))}
      <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(32,24,18,0.3),rgba(32,24,18,0.36),rgba(32,24,18,0.42))]" />
    </div>
  );
}

export function AttractModePanel({
  storeName,
  storeLogoUrl,
  backgroundImageUrls,
  onStart,
}: AttractModePanelProps) {
  const [isExiting, setIsExiting] = useState(false);
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const handleStart = () => {
    if (isExiting) return;
    const prefersReducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const delayMs = prefersReducedMotion ? 0 : 220;

    setIsExiting(true);
    timeoutRef.current = window.setTimeout(() => {
      onStart();
      timeoutRef.current = null;
      setIsExiting(false);
    }, delayMs);
  };

  return (
    <section
      data-attract-mode="true"
      className={cn(
        "relative flex min-h-[100dvh] items-center justify-center overflow-hidden px-4 pb-[max(24px,env(safe-area-inset-bottom))] pt-[max(24px,env(safe-area-inset-top))] transition-opacity duration-200 ease-out sm:px-8",
        isExiting ? "opacity-0" : "opacity-100"
      )}
    >
      <AttractCanvasBackdrop imageUrls={backgroundImageUrls} />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(58,44,29,0.3),rgba(40,29,19,0.42))]" />

      <div
        className={cn(
          "relative z-[1] w-[min(760px,calc(100vw-32px))] rounded-[20px] border border-[#DCCFBE] bg-[color:rgba(250,246,240,0.9)] px-[22px] pb-[28px] pt-[32px] shadow-[0_24px_64px_rgba(32,24,17,0.24)] transition-transform duration-200 ease-out sm:w-[min(680px,calc(100vw-56px))] sm:rounded-[24px] sm:px-[56px] sm:pb-[44px] sm:pt-[56px]",
          isExiting ? "translate-y-1" : "translate-y-0"
        )}
      >
        <StoreHeroLockup storeName={storeName} storeLogoUrl={storeLogoUrl} />

        <h2 className="mt-[26px] text-balance text-center font-serif text-[clamp(34px,5.2vw,58px)] font-medium leading-[1.06] tracking-[-0.02em] text-[var(--text-primary)]">
          Discover{" "}
          <span className="whitespace-nowrap">
            In‑Stock
          </span>{" "}
          Rugs
        </h2>

        <p className="mx-auto mt-[14px] max-w-[44ch] text-balance text-center text-[clamp(16px,1.9vw,20px)] leading-[1.4] text-[color:color-mix(in_srgb,var(--text-secondary)_90%,#4e3d2f)]">
          Curated recommendations for your room and style preferences.
        </p>

        <div className="mt-[30px] flex justify-center">
          <button
            type="button"
            onClick={handleStart}
            disabled={isExiting}
            className="min-h-14 rounded-full border border-[#C9B28D] bg-[linear-gradient(180deg,#f7ebd2_0%,#ecd9b4_100%)] px-6 text-[18px] font-semibold text-[var(--text-primary)] shadow-[0_8px_22px_rgba(58,42,23,0.16)] transition active:scale-[0.985] focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_rgba(201,161,74,0.30)] md:hover:brightness-[0.985] sm:h-[62px] sm:px-[30px]"
          >
            Tap to Start
          </button>
        </div>
      </div>
    </section>
  );
}
