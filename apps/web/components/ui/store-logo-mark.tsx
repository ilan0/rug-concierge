"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";

type StoreLogoMarkProps = {
  storeName: string;
  logoUrl: string | null;
  containerClassName: string;
  imageClassName?: string;
  fallbackTextClassName?: string;
};

const FALLBACK_STORE_NAME = "Rug Gallery Concierge";

function monogramFromStoreName(storeName: string): string {
  const tokens = storeName
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0)
    .slice(0, 2);
  if (tokens.length === 0) return "RG";
  return tokens.map((token) => token[0]?.toUpperCase() ?? "").join("") || "RG";
}

export function StoreLogoMark({
  storeName,
  logoUrl,
  containerClassName,
  imageClassName,
  fallbackTextClassName,
}: StoreLogoMarkProps) {
  const normalizedStoreName = storeName.trim().length > 0 ? storeName : FALLBACK_STORE_NAME;
  const [showImage, setShowImage] = useState(Boolean(logoUrl));
  const monogram = useMemo(() => monogramFromStoreName(normalizedStoreName), [normalizedStoreName]);

  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border border-[var(--border-primary)] bg-[var(--surface-2)]",
        containerClassName
      )}
      aria-hidden="true"
    >
      {showImage && logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logoUrl}
          alt=""
          className={cn("h-full w-full object-contain p-1.5", imageClassName)}
          loading="eager"
          decoding="async"
          onError={() => setShowImage(false)}
        />
      ) : (
        <span
          className={cn(
            "flex h-full w-full items-center justify-center font-semibold tracking-[0.08em] text-[var(--text-secondary)]",
            fallbackTextClassName
          )}
        >
          {monogram}
        </span>
      )}
    </div>
  );
}
