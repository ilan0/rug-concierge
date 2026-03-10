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

type StaffRugDetailModalProps = {
  row: InventoryBrowserRow | null;
  open: boolean;
  onClose: () => void;
};

function formatNumber(value: number): string {
  if (Number.isInteger(value)) return `${value}`;
  return value.toFixed(1).replace(/\.0$/, "");
}

function formatSizeValue(
  widthIn: number | null,
  lengthIn: number | null
): string | null {
  if (typeof widthIn !== "number" || typeof lengthIn !== "number") return null;
  return `${formatNumber(widthIn)} x ${formatNumber(lengthIn)} in`;
}

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
  const sizeLabel = formatSizeValue(row?.width_total_in ?? null, row?.length_total_in ?? null);
  const title = row?.intake_label ?? sizeLabel ?? "Untitled";
  const statusLabel = toStatusLabel(row?.status ?? null);
  const structuredEntries = row?.ai_structured_fields
    ? Object.entries(row.ai_structured_fields)
    : [];
  const hasDescription =
    typeof row?.ai_description === "string" && row.ai_description.trim().length > 0;

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

              <div className="overflow-hidden rounded-xl border border-border/70 bg-muted">
                <div className="aspect-[3/4] w-full">
                  <RugImage
                    src={row.primary_image_url}
                    alt={title}
                    placeholderLabel="No image available"
                  />
                </div>
              </div>

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
                ) : !row.ai_structured_fields && !hasDescription ? (
                  <p className="text-sm text-muted-foreground">
                    AI processing pending - check back shortly.
                  </p>
                ) : null}
              </section>

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
