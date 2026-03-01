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
  if (typeof src === "string" && src.trim().length > 0) {
    return (
      // External Supabase storage image URLs are rendered directly for MVP.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={alt}
        className={cn("h-full w-full object-cover", className)}
        loading="lazy"
        decoding="async"
      />
    );
  }

  return (
    <div
      className={cn(
        "flex h-full w-full items-center justify-center bg-muted text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground",
        placeholderClassName
      )}
      aria-label={placeholderLabel}
    >
      {placeholderLabel}
    </div>
  );
}
