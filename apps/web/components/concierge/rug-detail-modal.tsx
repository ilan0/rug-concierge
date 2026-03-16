"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RugImage } from "@/components/ui/rug-image";

export type RugDetailData = {
  id: string;
  intake_label: string | null;
  effective_fields: {
    label: string;
    origin?: string | null;
    style?: string | null;
    pattern?: string[] | null;
    primary_colors?: string[] | null;
    age_category?: string | null;
    mood?: string | null;
  };
  ai_description: string | null;
  size_display: string;
  primary_image_url: string | null;
};

type RugDetailModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isLoading: boolean;
  error: string | null;
  detail: RugDetailData | null;
  onShare?: () => void;
};

export function RugDetailModal({
  open,
  onOpenChange,
  isLoading,
  error,
  detail,
  onShare,
}: RugDetailModalProps) {
  const displayLabel =
    detail?.effective_fields.label ??
    detail?.intake_label ??
    detail?.size_display ??
    "Untitled";
  const valueChips = detail
    ? [
        detail.effective_fields.origin,
        detail.effective_fields.style,
        detail.effective_fields.mood,
        detail.effective_fields.pattern?.[0] ?? null,
      ].filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] max-w-3xl overflow-y-auto p-0">
        <div className="space-y-4 p-4 sm:p-6">
          {isLoading ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Loading rug details...</p>
              <div className="h-64 animate-pulse rounded-lg bg-muted" />
            </div>
          ) : error ? (
            <div className="space-y-2">
              <DialogTitle>Unable to load details</DialogTitle>
              <DialogDescription>{error}</DialogDescription>
            </div>
          ) : detail ? (
            <>
              <DialogHeader>
                <DialogTitle className="font-serif text-3xl leading-tight">{displayLabel}</DialogTitle>
                <DialogDescription className="italic">Size: {detail.size_display}</DialogDescription>
              </DialogHeader>

              <div className="overflow-hidden rounded-xl border border-border/70 bg-muted">
                <div className="aspect-[3/4] w-full">
                  <RugImage
                    src={detail.primary_image_url}
                    alt={displayLabel}
                    placeholderLabel="No image available"
                  />
                </div>
              </div>

              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-primary">
                  Description
                </h3>
                <p className="text-sm leading-6 text-foreground/90">
                  {detail.ai_description ??
                    "Description is being generated — check back shortly."}
                </p>
              </section>

              {valueChips.length > 0 ? (
                <section className="space-y-2">
                  <div className="flex flex-wrap gap-2">
                    {valueChips.map((chip) => (
                      <span
                        key={`${detail.id}-${chip}`}
                        className="rounded-full border border-border/55 bg-background/70 px-2.5 py-1 text-xs font-medium text-muted-foreground"
                      >
                        {chip}
                      </span>
                    ))}
                  </div>
                </section>
              ) : null}

            </>
          ) : null}

          <DialogFooter>
            {onShare ? (
              <Button
                type="button"
                variant="outline"
                onClick={onShare}
                disabled={isLoading || !detail}
              >
                Share
              </Button>
            ) : null}
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
