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
import type { InventoryBrowserRow } from "@/lib/types/inventory";
import { formatRugSize } from "@/lib/utils/format";

type StaffRugDetailModalProps = {
  row: InventoryBrowserRow | null;
  open: boolean;
  onClose: () => void;
};

function toStatusLabel(status: string | null): string {
  if (status === "available") return "Available";
  if (status === "on_hold") return "On Hold";
  if (status === "sold") return "Sold";
  if (!status) return "Unknown";
  return status
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function toKeyLabel(key: string): string {
  const spaced = key.replace(/_/g, " ").trim();
  return spaced.replace(/\b\w/g, (char) => char.toUpperCase());
}

export function StaffRugDetailModal({
  row,
  open,
  onClose,
}: StaffRugDetailModalProps) {
  const sizeLabel = formatRugSize(
    row?.width_total_in ?? null,
    row?.length_total_in ?? null
  );
  const title = row?.intake_label ?? sizeLabel ?? "Untitled";
  const statusLabel = toStatusLabel(row?.status ?? null);
  const structuredEntries = row?.ai_structured_fields
    ? Object.entries(row.ai_structured_fields)
    : [];
  const hasDescription =
    typeof row?.ai_description === "string" && row.ai_description.trim().length > 0;
  const showAiDetailsSection =
    structuredEntries.length > 0 || (!row?.ai_structured_fields && !hasDescription);

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto p-0">
        <div className="space-y-4 p-4 sm:p-6">
          {row ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="inline-flex items-center rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-primary">
                  {statusLabel}
                </span>
                {row.stock_id ? (
                  <span className="text-xs font-mono text-muted-foreground">
                    Stock ID: {row.stock_id}
                  </span>
                ) : null}
              </div>

              <DialogHeader>
                <DialogTitle className="font-serif text-3xl leading-tight">{title}</DialogTitle>
                <DialogDescription className="italic">
                  Size: {sizeLabel ?? "Unknown size"}
                </DialogDescription>
              </DialogHeader>

              <div className="flex flex-col gap-5 sm:flex-row">
                <div className="shrink-0 sm:w-44">
                  <div className="aspect-[3/4] max-h-52 overflow-hidden rounded-lg bg-muted sm:max-h-none">
                    <RugImage
                      src={row.primary_image_url}
                      alt={title}
                      placeholderLabel="No image available"
                    />
                  </div>
                </div>
                <div className="min-w-0 flex-1 space-y-4">
                  {hasDescription ? (
                    <section className="space-y-2">
                      <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-primary">
                        Description
                      </h3>
                      <p className="text-sm leading-6 text-foreground/90">
                        {row.ai_description}
                      </p>
                    </section>
                  ) : null}

                  {showAiDetailsSection ? (
                    <section className="space-y-2">
                      <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-primary">
                        AI Details
                      </h3>
                      {structuredEntries.length > 0 ? (
                        <div className="grid gap-2 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)]">
                          {structuredEntries.map(([key, value]) => (
                            <div key={key} className="contents">
                              <p className="text-sm font-medium text-foreground/85">{toKeyLabel(key)}</p>
                              <p className="text-sm text-foreground/90">{String(value)}</p>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          AI processing pending - check back shortly.
                        </p>
                      )}
                    </section>
                  ) : null}
                </div>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No rug selected.</p>
          )}

          <DialogFooter>
            <Button type="button" variant="default" onClick={onClose}>
              Close
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
