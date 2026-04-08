"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { RugImage } from "@/components/ui/rug-image";
import { StaffRugDetailModal } from "@/components/inventory/staff-rug-detail-modal";
import { reviewReasonMessage } from "@/lib/inventory/enrichment-state";
import type { InventoryBrowserRow } from "@/lib/types/inventory";
import { formatRugSize } from "@/lib/utils/format";

type InventoryTableClientProps = {
  rows: InventoryBrowserRow[];
};

const INVENTORY_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "numeric",
  day: "numeric",
  timeZone: "UTC",
});

function formatDate(value: string | null): string {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return INVENTORY_DATE_FORMATTER.format(parsed);
}

function toEffectiveAvailability(input: {
  status: string | null;
  enrichmentStatus: string | null;
}): "available" | "not_available" {
  if (input.status === "available" && input.enrichmentStatus === "ready") {
    return "available";
  }
  return "not_available";
}

export function StatusBadge(input: {
  status: string | null;
  enrichmentStatus: string | null;
}) {
  const effective = toEffectiveAvailability(input);
  if (effective === "available")
    return (
      <span className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700">
        <span className="size-2 shrink-0 rounded-full bg-emerald-500" />
        Available
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1.5 text-sm font-medium text-red-700">
      <span className="size-2 shrink-0 rounded-full bg-red-500" />
      Not Available
    </span>
  );
}

function readiness(row: InventoryBrowserRow): {
  displayLabel: string;
  enrichmentState: "processing" | "ready" | "needs_review";
  reviewMessage: string | null;
  autoNamed: boolean;
} {
  const sizeLabel = formatRugSize(row.width_total_in, row.length_total_in);
  const mergedLabel = row.effective_label?.trim() || row.intake_label?.trim() || null;
  const label = mergedLabel || sizeLabel || "Untitled";
  const enrichmentState =
    row.enrichment_status ??
    (mergedLabel ? "ready" : "processing");
  const ready = enrichmentState === "ready";
  const hasStaffLabelOverride = Boolean(
    row.staff_overrides?.label && row.staff_overrides.label.trim().length > 0
  );
  const autoNamed = ready && /^rug\s+[a-f0-9-]{6,}$/i.test(label) && !hasStaffLabelOverride;
  const reviewMessage =
    enrichmentState === "needs_review"
      ? reviewReasonMessage(row.review_reason_code)
      : null;

  return {
    displayLabel: label,
    enrichmentState,
    reviewMessage,
    autoNamed,
  };
}

export function InventoryTableClient({ rows }: InventoryTableClientProps) {
  const router = useRouter();
  const [selectedRow, setSelectedRow] = useState<InventoryBrowserRow | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [initialEditField, setInitialEditField] = useState<"label" | null>(null);

  const onOpenRow = (row: InventoryBrowserRow, focusField: "label" | null = null) => {
    setSelectedRow(row);
    setInitialEditField(focusField);
    setModalOpen(true);
  };

  return (
    <>
      {rows.length === 0 ? (
        <div className="rounded-xl border border-border/60 bg-background/70 p-5 text-sm text-muted-foreground">
          No inventory rows found.
        </div>
      ) : (
        <>
          <div className="space-y-3 md:hidden">
            {rows.map((row) => {
              const { displayLabel, enrichmentState, reviewMessage, autoNamed } =
                readiness(row);
              return (
                <article
                  key={row.id}
                  className="cursor-pointer rounded-xl border border-border/65 bg-background/80 p-3 transition-colors hover:bg-secondary/30"
                  onClick={() => onOpenRow(row)}
                >
                  <div className="mb-2 flex items-start gap-2.5">
                    <div className="h-16 w-14 shrink-0 overflow-hidden rounded-md border border-border/70 bg-muted">
                      <RugImage
                        src={row.primary_image_url}
                        alt={displayLabel}
                        loading="eager"
                      />
                    </div>
                    <div className="min-w-0 space-y-1">
                      <p
                        className={
                          enrichmentState === "ready"
                            ? "text-lg font-semibold leading-tight"
                            : "text-lg leading-tight text-muted-foreground"
                        }
                      >
                        {displayLabel}
                      </p>
                      {enrichmentState === "processing" ? (
                        <p className="inline-flex items-center gap-1.5 text-xs text-amber-600">
                          <span className="size-2 rounded-full bg-amber-400" />
                          Processing...
                        </p>
                      ) : enrichmentState === "needs_review" ? (
                        <p className="inline-flex items-center gap-1.5 text-xs text-red-700">
                          <span className="size-2 rounded-full bg-red-500" />
                          Needs Review
                        </p>
                      ) : autoNamed ? (
                        <button
                          type="button"
                          className="inline-flex items-center rounded-full border border-border/60 bg-background px-2.5 py-0.5 text-xs text-muted-foreground hover:border-primary/30 hover:bg-primary/10 hover:text-foreground"
                          onClick={(event) => {
                            event.stopPropagation();
                            onOpenRow(row, "label");
                          }}
                        >
                          Auto-named
                        </button>
                      ) : null}
                      {enrichmentState === "needs_review" && reviewMessage ? (
                        <p className="text-xs text-red-700">{reviewMessage}</p>
                      ) : null}
                    </div>
                  </div>

                  <div className="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1 text-sm leading-tight">
                    <span className="text-muted-foreground">Stock</span>
                    <span>
                      {row.stock_id ? (
                        <span className="font-mono text-xs">{row.stock_id}</span>
                      ) : (
                        "-"
                      )}
                    </span>

                    <span className="text-muted-foreground">Status</span>
                    <StatusBadge
                      status={row.status}
                      enrichmentStatus={row.enrichment_status}
                    />

                    <span className="text-muted-foreground">Size</span>
                    <span>{formatRugSize(row.width_total_in, row.length_total_in) || "-"}</span>

                    <span className="text-muted-foreground">Added</span>
                    <span>{formatDate(row.created_at)}</span>
                  </div>

                  <div className="mt-2.5">
                    <button
                      type="button"
                      className="inline-flex h-8 items-center rounded-full border border-border/60 bg-background px-3 text-xs font-medium text-foreground/85 hover:border-primary/35 hover:bg-primary/10 hover:text-foreground"
                      onClick={(event) => {
                        event.stopPropagation();
                        onOpenRow(row);
                      }}
                    >
                      Open details
                    </button>
                  </div>
                </article>
              );
            })}
          </div>

          <div
            className="hidden overflow-hidden rounded-xl border border-border/70 md:block"
            tabIndex={0}
            role="region"
            aria-label="Inventory table"
          >
            <table className="w-full table-fixed border-collapse text-sm">
              <thead className="bg-secondary/50 text-left">
                <tr>
                  <th className="w-[84px] p-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Image</th>
                  <th className="w-[36%] p-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Label</th>
                  <th className="w-[14%] p-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Stock ID</th>
                  <th className="w-[13%] p-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Size</th>
                  <th className="w-[11%] p-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Status</th>
                  <th className="hidden w-[10%] p-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground 2xl:table-cell">Added</th>
                  <th className="w-[74px] p-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Edit</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const { displayLabel, enrichmentState, reviewMessage, autoNamed } =
                    readiness(row);
                  return (
                    <tr
                      key={row.id}
                      className="cursor-pointer border-t border-border transition-colors hover:bg-secondary/30"
                      onClick={() => onOpenRow(row)}
                    >
                      <td className="p-3 align-top">
                        <div className="h-20 w-[3.4rem] overflow-hidden rounded-md border border-border/70 bg-muted">
                        <RugImage
                          src={row.primary_image_url}
                          alt={displayLabel}
                          loading="eager"
                        />
                        </div>
                      </td>
                      <td className="p-3 align-top">
                        <p
                          className={
                            enrichmentState === "ready"
                              ? "line-clamp-3 break-words font-medium leading-snug"
                              : "line-clamp-3 break-words leading-snug text-muted-foreground"
                          }
                        >
                          {displayLabel}
                        </p>
                        {enrichmentState === "processing" ? (
                          <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-amber-600">
                            <span className="size-2 rounded-full bg-amber-400" />
                            Processing...
                          </p>
                        ) : enrichmentState === "needs_review" ? (
                          <>
                            <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-red-700">
                              <span className="size-2 rounded-full bg-red-500" />
                              Needs Review
                            </p>
                            {reviewMessage ? (
                              <p className="mt-1 text-xs text-red-700">{reviewMessage}</p>
                            ) : null}
                          </>
                        ) : autoNamed ? (
                          <button
                            type="button"
                            className="mt-1 inline-flex items-center rounded-full border border-border/60 bg-background px-2.5 py-0.5 text-xs text-muted-foreground hover:border-primary/30 hover:bg-primary/10 hover:text-foreground"
                            onClick={(event) => {
                              event.stopPropagation();
                              onOpenRow(row, "label");
                            }}
                          >
                            Auto-named
                          </button>
                        ) : null}
                      </td>
                      <td className="p-3 align-top">
                        {row.stock_id ? (
                          <span className="block truncate text-xs font-mono">{row.stock_id}</span>
                        ) : (
                          "-"
                        )}
                      </td>
                      <td className="p-3 align-top">
                        {formatRugSize(row.width_total_in, row.length_total_in) || "-"}
                      </td>
                      <td className="p-3 align-top">
                        <StatusBadge
                          status={row.status}
                          enrichmentStatus={row.enrichment_status}
                        />
                      </td>
                      <td className="hidden p-3 align-top 2xl:table-cell">
                        {formatDate(row.created_at)}
                      </td>
                      <td className="p-3 align-top">
                        <button
                          type="button"
                          className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border/60 bg-background text-xs font-medium text-foreground/85 hover:border-primary/35 hover:bg-primary/10 hover:text-foreground"
                          onClick={(event) => {
                            event.stopPropagation();
                            onOpenRow(row);
                          }}
                          aria-label={`Edit ${displayLabel}`}
                        >
                          <Pencil className="size-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <StaffRugDetailModal
        row={selectedRow}
        open={modalOpen}
        initialEditField={initialEditField}
        onClose={() => {
          setModalOpen(false);
          setInitialEditField(null);
          setSelectedRow(null);
          router.refresh();
        }}
      />
    </>
  );
}
