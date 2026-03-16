"use client";

import { useState } from "react";
import { RugImage } from "@/components/ui/rug-image";
import { StaffRugDetailModal } from "@/components/inventory/staff-rug-detail-modal";
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

export function StatusBadge({ status }: { status: string | null }) {
  if (status === "available")
    return (
      <span className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700">
        <span className="size-2 shrink-0 rounded-full bg-emerald-500" />
        available
      </span>
    );
  if (status === "on_hold")
    return (
      <span className="inline-flex items-center gap-1.5 text-sm font-medium text-amber-700">
        <span className="size-2 shrink-0 rounded-full bg-amber-500" />
        on hold
      </span>
    );
  if (status === "sold")
    return (
      <span className="inline-flex items-center gap-1.5 text-sm font-medium text-red-700">
        <span className="size-2 shrink-0 rounded-full bg-red-500" />
        sold
      </span>
    );
  return <span className="text-sm text-muted-foreground">{status ?? "-"}</span>;
}

function readiness(row: InventoryBrowserRow): {
  displayLabel: string;
  ready: boolean;
  autoNamed: boolean;
} {
  const sizeLabel = formatRugSize(row.width_total_in, row.length_total_in);
  const mergedLabel = row.effective_label?.trim() || row.intake_label?.trim() || null;
  const label = mergedLabel || sizeLabel || "Untitled";
  const ready = Boolean(mergedLabel);
  const hasStaffLabelOverride = Boolean(
    row.staff_overrides?.label && row.staff_overrides.label.trim().length > 0
  );
  const autoNamed = ready && /^rug\s+[a-f0-9-]{6,}$/i.test(label) && !hasStaffLabelOverride;

  return {
    displayLabel: label,
    ready,
    autoNamed,
  };
}

export function InventoryTableClient({ rows }: InventoryTableClientProps) {
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
              const { displayLabel, ready, autoNamed } = readiness(row);
              return (
                <article
                  key={row.id}
                  className="cursor-pointer rounded-xl border border-border/65 bg-background/80 p-2.5 transition-colors hover:bg-secondary/30"
                  onClick={() => onOpenRow(row)}
                >
                  <div className="mb-2 flex items-start gap-2.5">
                    <div className="h-16 w-14 shrink-0 overflow-hidden rounded-md border border-border/70 bg-muted">
                      <RugImage src={row.primary_image_url} alt={displayLabel} />
                    </div>
                    <div className="min-w-0 space-y-1">
                      <p className={ready ? "text-lg font-semibold leading-tight" : "text-lg leading-tight text-muted-foreground"}>
                        {displayLabel}
                      </p>
                      {!ready ? (
                        <p className="inline-flex items-center gap-1.5 text-xs text-amber-600">
                          <span className="size-2 rounded-full bg-amber-400" />
                          Processing...
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
                    <StatusBadge status={row.status} />

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
                      View details
                    </button>
                  </div>
                </article>
              );
            })}
          </div>

          <div
            className="hidden overflow-x-auto rounded-xl border border-border/70 md:block"
            tabIndex={0}
            role="region"
            aria-label="Inventory table"
          >
            <table className="w-full min-w-[1080px] border-collapse text-[0.95rem]">
              <thead className="bg-secondary/50 text-left">
                <tr>
                  <th className="p-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Image</th>
                  <th className="p-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Label</th>
                  <th className="p-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Stock ID</th>
                  <th className="p-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Status</th>
                  <th className="p-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Size</th>
                  <th className="p-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Added</th>
                  <th className="p-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const { displayLabel, ready, autoNamed } = readiness(row);
                  return (
                    <tr
                      key={row.id}
                      className="cursor-pointer border-t border-border transition-colors hover:bg-secondary/30"
                      onClick={() => onOpenRow(row)}
                    >
                      <td className="p-3 align-top">
                        <div className="h-20 w-16 overflow-hidden rounded-md border border-border/70 bg-muted">
                          <RugImage src={row.primary_image_url} alt={displayLabel} />
                        </div>
                      </td>
                      <td className="p-3 align-top">
                        <p className={ready ? "font-medium" : "text-muted-foreground"}>
                          {displayLabel}
                        </p>
                        {!ready ? (
                          <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-amber-600">
                            <span className="size-2 rounded-full bg-amber-400" />
                            Processing...
                          </p>
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
                          <span className="text-xs font-mono">{row.stock_id}</span>
                        ) : (
                          "-"
                        )}
                      </td>
                      <td className="p-3 align-top">
                        <StatusBadge status={row.status} />
                      </td>
                      <td className="p-3 align-top">
                        {formatRugSize(row.width_total_in, row.length_total_in) || "-"}
                      </td>
                      <td className="p-3 align-top">{formatDate(row.created_at)}</td>
                      <td className="p-3 align-top">
                        <button
                          type="button"
                          className="inline-flex h-8 items-center rounded-full border border-border/60 bg-background px-3 text-xs font-medium text-foreground/85 hover:border-primary/35 hover:bg-primary/10 hover:text-foreground"
                          onClick={(event) => {
                            event.stopPropagation();
                            onOpenRow(row);
                          }}
                        >
                          View details
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
        }}
      />
    </>
  );
}
