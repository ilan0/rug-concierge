"use client";

import { useState } from "react";
import { RugImage } from "@/components/ui/rug-image";
import { StaffRugDetailModal } from "@/components/inventory/staff-rug-detail-modal";
import type { InventoryBrowserRow } from "@/lib/types/inventory";

type InventoryTableClientProps = {
  rows: InventoryBrowserRow[];
};

function formatNumber(value: number): string {
  if (Number.isInteger(value)) return `${value}`;
  return value.toFixed(1).replace(/\.0$/, "");
}

function formatSize(
  widthIn: number | null,
  lengthIn: number | null
): string | null {
  if (typeof widthIn !== "number" || typeof lengthIn !== "number") return null;
  return `${formatNumber(widthIn)} x ${formatNumber(lengthIn)} in`;
}

function formatDate(value: string | null): string {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleDateString();
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
} {
  const sizeLabel = formatSize(row.width_total_in, row.length_total_in);
  const label = row.intake_label?.trim() || sizeLabel || "Untitled";
  return {
    displayLabel: label,
    ready: Boolean(row.intake_label && row.intake_label.trim().length > 0),
  };
}

export function InventoryTableClient({ rows }: InventoryTableClientProps) {
  const [selectedRow, setSelectedRow] = useState<InventoryBrowserRow | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const onOpenRow = (row: InventoryBrowserRow) => {
    setSelectedRow(row);
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
              const { displayLabel, ready } = readiness(row);
              return (
                <article
                  key={row.id}
                  className="cursor-pointer rounded-xl border border-border/65 bg-background/80 p-3 transition-colors hover:bg-secondary/30"
                  onClick={() => onOpenRow(row)}
                >
                  <div className="mb-2 flex items-start gap-3">
                    <div className="h-20 w-16 shrink-0 overflow-hidden rounded-md border border-border/70 bg-muted">
                      <RugImage src={row.primary_image_url} alt={displayLabel} />
                    </div>
                    <div className="min-w-0 space-y-1">
                      <p className={ready ? "text-base font-semibold" : "text-base text-muted-foreground"}>
                        {displayLabel}
                      </p>
                      <p className="inline-flex items-center gap-1.5 text-xs">
                        <span
                          className={
                            ready
                              ? "size-2 rounded-full bg-emerald-500"
                              : "size-2 rounded-full bg-amber-400"
                          }
                        />
                        {ready ? "AI ready" : "AI pending"}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-2 text-sm">
                    <p>
                      <span className="font-semibold">Stock ID:</span>{" "}
                      {row.stock_id ? (
                        <span className="font-mono text-xs">{row.stock_id}</span>
                      ) : (
                        "-"
                      )}
                    </p>
                    <p>
                      <span className="font-semibold">Status:</span>{" "}
                      <StatusBadge status={row.status} />
                    </p>
                    <p>
                      <span className="font-semibold">Size:</span>{" "}
                      {formatSize(row.width_total_in, row.length_total_in) ?? "-"}
                    </p>
                    <p>
                      <span className="font-semibold">Added:</span> {formatDate(row.created_at)}
                    </p>
                  </div>
                </article>
              );
            })}
          </div>

          <div className="hidden overflow-x-auto rounded-xl border border-border/70 md:block">
            <table className="w-full min-w-[1080px] border-collapse text-[0.95rem]">
              <thead className="bg-secondary/50 text-left">
                <tr>
                  <th className="p-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Image</th>
                  <th className="p-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Label + Readiness</th>
                  <th className="p-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Stock ID</th>
                  <th className="p-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Status</th>
                  <th className="p-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Size</th>
                  <th className="p-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Added</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const { displayLabel, ready } = readiness(row);
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
                        <p className="mt-1 inline-flex items-center gap-1.5 text-xs">
                          <span
                            className={
                              ready
                                ? "size-2 rounded-full bg-emerald-500"
                                : "size-2 rounded-full bg-amber-400"
                            }
                          />
                          {ready ? "AI ready" : "AI pending"}
                        </p>
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
                        {formatSize(row.width_total_in, row.length_total_in) ?? "-"}
                      </td>
                      <td className="p-3 align-top">{formatDate(row.created_at)}</td>
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
        onClose={() => setModalOpen(false)}
      />
    </>
  );
}
