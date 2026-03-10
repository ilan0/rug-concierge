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
  ai_description: string | null;
  contextual_blurb: string | null;
  ai_structured_fields: Record<string, unknown> | null;
  stock_id: string | null;
  status: string | null;
  size_display: string;
  primary_image_url: string | null;
};

type RugDetailModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isLoading: boolean;
  error: string | null;
  detail: RugDetailData | null;
};

export function RugDetailModal({
  open,
  onOpenChange,
  isLoading,
  error,
  detail,
}: RugDetailModalProps) {
  const displayLabel = detail?.intake_label ?? detail?.size_display ?? "Untitled";

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

              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-primary">
                  Context
                </h3>
                <p className="text-sm leading-6 text-foreground/90">
                  {detail.contextual_blurb ?? "No contextual guidance yet."}
                </p>
              </section>
            </>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="default" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
