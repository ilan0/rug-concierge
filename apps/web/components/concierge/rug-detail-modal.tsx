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
      <DialogContent className="!top-auto !bottom-0 !w-screen !max-w-none !translate-y-0 overflow-hidden rounded-t-[24px] border-[var(--active-border,var(--border-primary))] bg-[color:color-mix(in_srgb,var(--active-surface,var(--surface))_97%,white)] p-0 shadow-[var(--active-shadow-2,0_18px_42px_rgba(31,21,9,0.18))] sm:!top-[50%] sm:!bottom-auto sm:!w-[min(94vw,940px)] sm:!max-w-[940px] sm:!translate-y-[-50%] sm:rounded-[28px] lg:!w-[min(92vw,1080px)] lg:!max-w-[1080px]">
        <div className="flex h-[min(92dvh,860px)] min-h-[28rem] flex-col sm:h-[min(84dvh,760px)]">
          {isLoading ? (
            <div className="flex min-h-0 flex-1 flex-col px-[18px] py-[18px] sm:px-6 sm:py-6">
              <DialogHeader className="shrink-0">
                <DialogTitle className="font-serif text-[34px] leading-[38px] text-[var(--active-text,var(--text-primary))] sm:text-[42px] sm:leading-[46px]">
                  Loading rug details...
                </DialogTitle>
                <DialogDescription className="text-[var(--active-text-soft,var(--text-secondary))]">
                  Fetching image and details.
                </DialogDescription>
              </DialogHeader>
              <div className="mt-4 min-h-0 flex-1 overflow-hidden rounded-2xl border border-[var(--active-border,var(--border-primary))] bg-[var(--active-surface-2,var(--surface-2))]">
                <div className="h-full w-full animate-pulse bg-gradient-to-br from-[var(--active-surface-2,var(--surface-2))] via-[color:color-mix(in_srgb,var(--active-surface-2,var(--surface-2))_78%,white)] to-[var(--active-surface,var(--surface))]" />
              </div>
            </div>
          ) : error ? (
            <div className="flex min-h-0 flex-1 flex-col px-[18px] py-[18px] sm:px-6 sm:py-6">
              <DialogHeader className="shrink-0">
                <DialogTitle className="font-serif text-[34px] leading-[38px] text-[var(--active-text,var(--text-primary))] sm:text-[42px] sm:leading-[46px]">
                  Unable to load details
                </DialogTitle>
                <DialogDescription className="text-[var(--active-text-soft,var(--text-secondary))]">{error}</DialogDescription>
              </DialogHeader>
            </div>
          ) : detail ? (
            <div className="flex min-h-0 flex-1 flex-col px-[18px] py-[18px] sm:px-6 sm:py-6">
              <DialogHeader className="shrink-0 gap-1 pb-3 text-left">
                <DialogTitle className="line-clamp-2 font-serif text-[34px] leading-[38px] tracking-[-0.013em] text-[var(--active-text,var(--text-primary))] sm:text-[42px] sm:leading-[46px] lg:text-[48px] lg:leading-[52px]">
                  {displayLabel}
                </DialogTitle>
                <DialogDescription className="text-[17px] leading-[26px] italic text-[var(--active-text-soft,var(--text-secondary))]">
                  Size: {detail.size_display}
                </DialogDescription>
              </DialogHeader>

              <div className="grid min-h-0 flex-1 gap-4 md:grid-cols-[minmax(0,1.38fr)_minmax(0,1fr)]">
                <div className="min-h-[18rem] overflow-hidden rounded-2xl border border-[var(--active-border,var(--border-primary))] bg-[var(--active-surface-2,var(--surface-2))]">
                  <div className="h-full w-full bg-[color:color-mix(in_srgb,var(--active-surface-2,var(--surface-2))_86%,white)] p-3 sm:p-4">
                    <RugImage
                      src={detail.primary_image_url}
                      alt={displayLabel}
                      className="h-full w-full"
                      fit="contain"
                      placeholderLabel="No image available"
                    />
                  </div>
                </div>

                <div className="min-h-0 rounded-2xl border border-[var(--active-border,var(--border-primary))] bg-[color:color-mix(in_srgb,var(--active-surface,var(--surface))_95%,white)] p-4 sm:p-5">
                  <section className="space-y-2">
                    <h3 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--active-text-soft,var(--text-secondary))]">
                      Description
                    </h3>
                    <p className="text-[16px] leading-[26px] text-[var(--active-text,var(--text-primary))] sm:text-[17px] sm:leading-[28px] [display:-webkit-box] [overflow:hidden] [-webkit-box-orient:vertical] [-webkit-line-clamp:12]">
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
                            className="rounded-full border border-[var(--active-border,var(--border-primary))] bg-[var(--active-surface,var(--surface))] px-2.5 py-1 text-xs font-medium text-[var(--active-text-soft,var(--text-secondary))]"
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
            <div className="flex min-h-0 flex-1 flex-col px-[18px] py-[18px] sm:px-6 sm:py-6">
              <DialogHeader className="shrink-0">
                <DialogTitle className="font-serif text-[34px] leading-[38px] text-[var(--active-text,var(--text-primary))] sm:text-[42px] sm:leading-[46px]">
                  Rug details unavailable
                </DialogTitle>
                <DialogDescription className="text-[var(--active-text-soft,var(--text-secondary))]">
                  We could not load this rug right now. Please try again.
                </DialogDescription>
              </DialogHeader>
            </div>
          )}

          {onShare ? (
            <DialogFooter className="shrink-0 gap-2 border-t border-[var(--divider-subtle,var(--divider))] px-[18px] py-3 sm:px-6">
              <Button
                type="button"
                variant="outline"
                className="min-h-11 border-[var(--active-border,var(--border-primary))] bg-[var(--active-surface,var(--surface))] px-4 text-[var(--active-text-soft,var(--text-secondary))] hover:bg-[var(--active-surface-2,var(--surface-2))]"
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
