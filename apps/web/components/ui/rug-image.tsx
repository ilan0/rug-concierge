"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";

type RugImageProps = {
  src: string | null | undefined;
  alt: string;
  className?: string;
  placeholderClassName?: string;
  placeholderLabel?: string;
};

export function RugImage({
  src,
  alt,
  className,
  placeholderClassName,
  placeholderLabel = "No image",
}: RugImageProps) {
  const normalizedSrc = useMemo(() => {
    if (typeof src !== "string") return null;
    const trimmed = src.trim();
    return trimmed.length > 0 ? trimmed : null;
  }, [src]);
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const loaded = normalizedSrc !== null && loadedSrc === normalizedSrc;
  const failed = normalizedSrc !== null && failedSrc === normalizedSrc;

  if (normalizedSrc && !failed) {
    return (
      <div className={cn("relative h-full w-full overflow-hidden", className)}>
        {!loaded ? (
          <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-muted via-muted/80 to-muted/60" />
        ) : null}
        {/* External Supabase storage image URLs are rendered directly for MVP. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={normalizedSrc}
          alt={alt}
          className={cn(
            "h-full w-full object-cover transition-opacity duration-200",
            loaded ? "opacity-100" : "opacity-0"
          )}
          loading="lazy"
          decoding="async"
          onLoad={() => setLoadedSrc(normalizedSrc)}
          onError={() => {
            setFailedSrc(normalizedSrc);
          }}
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex h-full w-full flex-col items-center justify-center gap-1 bg-muted/90 px-2 text-center text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground",
        placeholderClassName
      )}
      aria-label={placeholderLabel}
    >
      <span className="size-1.5 rounded-full bg-border/70" />
      {placeholderLabel}
    </div>
  );
}
