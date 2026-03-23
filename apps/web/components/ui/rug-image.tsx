"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

type RugImageProps = {
  src: string | null | undefined;
  alt: string;
  className?: string;
  placeholderClassName?: string;
  placeholderLabel?: string;
  loading?: "eager" | "lazy";
};

type RugImageSourceProps = {
  src: string;
  alt: string;
  className?: string;
  placeholderClassName?: string;
  placeholderLabel: string;
  loading: "eager" | "lazy";
};

type RugImagePlaceholderProps = {
  className?: string;
  label: string;
};

function RugImagePlaceholder({ className, label }: RugImagePlaceholderProps) {
  return (
    <div
      className={cn(
        "flex h-full w-full flex-col items-center justify-center gap-1 bg-muted/90 px-2 text-center text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground",
        className
      )}
      aria-label={label}
    >
      <span className="size-1.5 rounded-full bg-border/70" />
      {label}
    </div>
  );
}

function RugImageSource({
  src,
  alt,
  className,
  placeholderClassName,
  placeholderLabel,
  loading,
}: RugImageSourceProps) {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  const setImageRef = useCallback((node: HTMLImageElement | null) => {
    imgRef.current = node;

    if (!node) {
      return;
    }

    if (node.complete) {
      if (node.naturalWidth > 0) {
        setLoaded(true);
      } else {
        setFailed(true);
      }
    }
  }, []);

  if (failed) {
    return (
      <RugImagePlaceholder className={placeholderClassName} label={placeholderLabel} />
    );
  }

  return (
    <div className={cn("relative h-full w-full overflow-hidden", className)}>
      {!loaded ? (
        <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-muted via-muted/80 to-muted/60" />
      ) : null}
      {/* External Supabase storage image URLs are rendered directly for MVP. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={setImageRef}
        src={src}
        alt={alt}
        className={cn(
          "h-full w-full object-cover transition-opacity duration-200",
          loaded ? "opacity-100" : "opacity-0"
        )}
        loading={loading}
        decoding="async"
        onLoad={() => setLoaded(true)}
        onError={() => {
          setFailed(true);
        }}
      />
    </div>
  );
}

export function RugImage({
  src,
  alt,
  className,
  placeholderClassName,
  placeholderLabel = "No image",
  loading = "lazy",
}: RugImageProps) {
  const normalizedSrc = useMemo(() => {
    if (typeof src !== "string") return null;
    const trimmed = src.trim();
    return trimmed.length > 0 ? trimmed : null;
  }, [src]);

  if (normalizedSrc) {
    return (
      <RugImageSource
        key={normalizedSrc}
        src={normalizedSrc}
        alt={alt}
        className={className}
        placeholderClassName={placeholderClassName}
        placeholderLabel={placeholderLabel}
        loading={loading}
      />
    );
  }

  return <RugImagePlaceholder className={placeholderClassName} label={placeholderLabel} />;
}
