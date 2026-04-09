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
      <DialogContent className="max-h-[90dvh] w-[min(96vw,62rem)] overflow-hidden border-border/70 bg-card/96 p-0 shadow-[0_18px_46px_rgba(31,18,6,0.2)] backdrop-blur supports-[backdrop-filter]:bg-card/90">
        <div className="flex h-[min(86dvh,46rem)] min-h-[26rem] flex-col">
          {isLoading ? (
            <div className="flex min-h-0 flex-1 flex-col px-4 py-4 sm:px-6 sm:py-5">
              <DialogHeader className="shrink-0">
                <DialogTitle>Loading rug details...</DialogTitle>
                <DialogDescription>Fetching image and details.</DialogDescription>
              </DialogHeader>
              <div className="mt-4 min-h-0 flex-1 overflow-hidden rounded-xl border border-border/70 bg-muted/70">
                <div className="h-full w-full animate-pulse bg-gradient-to-br from-muted via-muted/80 to-muted/60" />
              </div>
            </div>
          ) : error ? (
            <div className="flex min-h-0 flex-1 flex-col px-4 py-4 sm:px-6 sm:py-5">
              <DialogHeader className="shrink-0">
                <DialogTitle>Unable to load details</DialogTitle>
                <DialogDescription>{error}</DialogDescription>
              </DialogHeader>
            </div>
          ) : detail ? (
            <div className="flex min-h-0 flex-1 flex-col px-4 py-4 sm:px-6 sm:py-5">
              <DialogHeader className="shrink-0 pb-2">
                <DialogTitle className="line-clamp-2 font-serif text-[1.8rem] leading-tight sm:text-[2rem]">
                  {displayLabel}
                </DialogTitle>
                <DialogDescription className="italic text-foreground/75">
                  Size: {detail.size_display}
                </DialogDescription>
              </DialogHeader>

              <div className="grid min-h-0 flex-1 gap-3 md:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
                <div className="min-h-0 overflow-hidden rounded-xl border border-border/70 bg-muted">
                  <div className="h-full w-full bg-muted/70 p-2 sm:p-3">
                    <RugImage
                      src={detail.primary_image_url}
                      alt={displayLabel}
                      className="h-full w-full"
                      fit="contain"
                      placeholderLabel="No image available"
                    />
                  </div>
                </div>

                <div className="min-h-0 rounded-xl border border-border/60 bg-background/70 p-3 sm:p-4">
                  <section className="space-y-2">
                    <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-primary">
                      Description
                    </h3>
                    <p className="text-sm leading-6 text-foreground/90 [display:-webkit-box] [overflow:hidden] [-webkit-box-orient:vertical] [-webkit-line-clamp:12]">
                      {detail.ai_description ??
                        "Description is being generated. Check back shortly."}
                    </p>
                  </section>

                  {valueChips.length > 0 ? (
                    <section className="mt-3 space-y-2">
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
                </div>
              </div>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col px-4 py-4 sm:px-6 sm:py-5">
              <DialogHeader className="shrink-0">
                <DialogTitle>Rug details unavailable</DialogTitle>
                <DialogDescription>
                  We could not load this rug right now. Please try again.
                </DialogDescription>
              </DialogHeader>
            </div>
          )}

          {onShare ? (
            <DialogFooter className="shrink-0 gap-2 border-t border-border/55 px-4 py-3 sm:px-6">
              <Button
                type="button"
                variant="outline"
                className="min-h-11 px-4"
                onClick={onShare}
                disabled={isLoading || !detail}
              >
                Share
              </Button>
            </DialogFooter>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
