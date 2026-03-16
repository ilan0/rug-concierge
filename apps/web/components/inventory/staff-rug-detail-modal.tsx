"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RugImage } from "@/components/ui/rug-image";
import { toast } from "sonner";
import {
  fetchStaffRugDetail,
  patchStaffRugDetail,
  reEnrichStaffRug,
} from "@/lib/inventory/staff-client";
import { resolveEffectiveFields } from "@/lib/inventory/resolve-fields";
import type {
  InventoryBrowserRow,
  StaffInventoryRugDetail,
  StaffOverrides,
} from "@/lib/types/inventory";
import { formatRugSize } from "@/lib/utils/format";

type StaffRugDetailModalProps = {
  row: InventoryBrowserRow | null;
  open: boolean;
  onClose: () => void;
  initialEditField?: "label" | null;
};

type EditDraft = {
  label: string;
  origin: string;
  style: string;
  pattern: string[];
  primary_colors: string[];
  age_category: string;
  mood: string;
  stock_id: string;
  status: "available" | "on_hold" | "sold";
};

const ORIGIN_OPTIONS = [
  "Persian",
  "Afghan",
  "Turkish",
  "Indian",
  "Caucasian",
  "Pakistani",
  "Other",
] as const;

const AGE_OPTIONS = ["antique", "semi-antique", "vintage", "new"] as const;
const MOOD_OPTIONS = ["traditional", "transitional", "eclectic", "modern"] as const;
const PATTERN_OPTIONS = [
  "medallion center",
  "all-over pattern",
  "geometric design",
  "floral motif",
  "tribal design",
  "floral border",
  "pictorial",
  "plain field",
] as const;
const COLOR_OPTIONS = [
  "red",
  "navy",
  "ivory",
  "gold",
  "rust",
  "teal",
  "brown",
  "green",
  "blue",
  "black",
  "cream",
  "coral",
] as const;

function toStatusLabel(status: string | null): string {
  if (status === "available") return "Available";
  if (status === "on_hold") return "On Hold";
  if (status === "sold") return "Sold";
  return "Unknown";
}

function normalizeList(values: string[]): string[] {
  const unique = new Set<string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    unique.add(trimmed);
  }
  return [...unique];
}

function hasOverride(detail: StaffInventoryRugDetail, key: keyof StaffOverrides) {
  if (!detail.staff_overrides) return false;
  if (!Object.prototype.hasOwnProperty.call(detail.staff_overrides, key)) return false;
  return detail.staff_overrides[key] !== null && detail.staff_overrides[key] !== undefined;
}

function formatList(value: string[] | null | undefined): string {
  if (!Array.isArray(value) || value.length === 0) return "—";
  return value.join(" · ");
}

function detailToDraft(detail: StaffInventoryRugDetail): EditDraft {
  return {
    label: detail.effective_fields.label ?? "",
    origin: detail.effective_fields.origin ?? "",
    style: detail.effective_fields.style ?? "",
    pattern: normalizeList(detail.effective_fields.pattern ?? []),
    primary_colors: normalizeList(detail.effective_fields.primary_colors ?? []),
    age_category: detail.effective_fields.age_category ?? "",
    mood: detail.effective_fields.mood ?? "",
    stock_id: detail.stock_id ?? "",
    status:
      detail.status === "on_hold" || detail.status === "sold"
        ? detail.status
        : "available",
  };
}

function rowToDetail(row: InventoryBrowserRow): StaffInventoryRugDetail {
  const effectiveFields = resolveEffectiveFields(
    row.intake_label,
    row.ai_structured_fields,
    row.staff_overrides
  );

  return {
    id: row.id,
    tenant_id: row.tenant_id ?? "",
    intake_label: row.intake_label,
    ai_description: row.ai_description,
    ai_structured_fields: row.ai_structured_fields,
    staff_overrides: row.staff_overrides,
    effective_fields: effectiveFields,
    stock_id: row.stock_id,
    status: row.status,
    width_total_in: row.width_total_in,
    length_total_in: row.length_total_in,
    created_at: row.created_at,
    primary_image_url: row.primary_image_url,
    primary_image_caption: row.primary_image_caption,
  };
}

export function StaffRugDetailModal({
  row,
  open,
  onClose,
  initialEditField,
}: StaffRugDetailModalProps) {
  const [detail, setDetail] = useState<StaffInventoryRugDetail | null>(
    row ? rowToDetail(row) : null
  );
  const [draft, setDraft] = useState<EditDraft | null>(
    row ? detailToDraft(rowToDetail(row)) : null
  );
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reAnalyzing, setReAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [patternInput, setPatternInput] = useState("");
  const [colorInput, setColorInput] = useState("");
  const labelInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open || !row) return;

    const seeded = rowToDetail(row);
    setDetail(seeded);
    setDraft(detailToDraft(seeded));
    setError(null);

    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const fetched = await fetchStaffRugDetail(row.id);
        if (cancelled) return;
        setDetail(fetched);
        setDraft(detailToDraft(fetched));
      } catch (nextError) {
        if (cancelled) return;
        setError(
          nextError instanceof Error
            ? nextError.message
            : "Unable to load rug details."
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [open, row]);

  useEffect(() => {
    if (!open) return;
    if (initialEditField === "label") {
      setEditMode(true);
    }
  }, [open, initialEditField]);

  useEffect(() => {
    if (!editMode) return;
    const timer = window.setTimeout(() => {
      labelInputRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [editMode]);

  const sizeLabel = formatRugSize(
    detail?.width_total_in ?? null,
    detail?.length_total_in ?? null
  );
  const title = detail?.effective_fields.label ?? sizeLabel ?? "Untitled";
  const statusLabel = toStatusLabel(detail?.status ?? null);

  const fieldRows = useMemo(() => {
    if (!detail) return [];
    return [
      {
        key: "origin" as const,
        label: "Origin",
        value: detail.effective_fields.origin ?? "—",
      },
      {
        key: "style" as const,
        label: "Style",
        value: detail.effective_fields.style ?? "—",
      },
      {
        key: "pattern" as const,
        label: "Pattern",
        value: formatList(detail.effective_fields.pattern),
      },
      {
        key: "primary_colors" as const,
        label: "Colors",
        value: formatList(detail.effective_fields.primary_colors),
      },
      {
        key: "age_category" as const,
        label: "Age",
        value: detail.effective_fields.age_category ?? "—",
      },
      {
        key: "mood" as const,
        label: "Mood",
        value: detail.effective_fields.mood ?? "—",
      },
    ];
  }, [detail]);

  const onToggleListValue = (field: "pattern" | "primary_colors", value: string) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const existing = prev[field];
      const nextValues = existing.includes(value)
        ? existing.filter((item) => item !== value)
        : [...existing, value];
      return {
        ...prev,
        [field]: normalizeList(nextValues),
      };
    });
  };

  const onAddCustomListValue = (field: "pattern" | "primary_colors") => {
    const raw = field === "pattern" ? patternInput : colorInput;
    const cleaned = raw.trim();
    if (!cleaned) return;

    setDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        [field]: normalizeList([...prev[field], cleaned]),
      };
    });

    if (field === "pattern") {
      setPatternInput("");
    } else {
      setColorInput("");
    }
  };

  const onRevertField = async (field: keyof StaffOverrides) => {
    if (!detail || saving) return;
    setSaving(true);
    setError(null);

    try {
      const payload: StaffOverrides = { [field]: null } as StaffOverrides;
      const updated = await patchStaffRugDetail(detail.id, {
        staff_overrides: payload,
      });
      setDetail(updated);
      setDraft(detailToDraft(updated));
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Unable to revert field right now."
      );
    } finally {
      setSaving(false);
    }
  };

  const onSaveEdits = async () => {
    if (!detail || !draft || saving) return;

    setSaving(true);
    setError(null);
    try {
      const updated = await patchStaffRugDetail(detail.id, {
        stock_id: draft.stock_id.trim() || null,
        status: draft.status,
        staff_overrides: {
          label: draft.label.trim() || null,
          origin: draft.origin || null,
          style: draft.style.trim() || null,
          pattern: draft.pattern.length > 0 ? normalizeList(draft.pattern) : null,
          primary_colors:
            draft.primary_colors.length > 0
              ? normalizeList(draft.primary_colors)
              : null,
          age_category: draft.age_category || null,
          mood: draft.mood || null,
        },
      });
      setDetail(updated);
      setDraft(detailToDraft(updated));
      setEditMode(false);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Unable to save changes right now."
      );
    } finally {
      setSaving(false);
    }
  };

  const onQuickStatusChange = async (status: "available" | "on_hold" | "sold") => {
    if (!detail || saving) return;
    setSaving(true);
    setError(null);

    try {
      const updated = await patchStaffRugDetail(detail.id, { status });
      setDetail(updated);
      setDraft(detailToDraft(updated));
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Unable to update status right now."
      );
    } finally {
      setSaving(false);
    }
  };

  const onReAnalyze = async () => {
    if (!detail || reAnalyzing) return;
    if (typeof window !== "undefined") {
      const confirmed = window.confirm(
        "Re-analyze this rug with AI? This will refresh AI fields and keep your staff overrides."
      );
      if (!confirmed) return;
    }
    setReAnalyzing(true);
    setError(null);
    try {
      const updated = await reEnrichStaffRug(detail.id);
      setDetail(updated);
      setDraft(detailToDraft(updated));
      toast.success("Rug re-analyzed successfully.");
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Unable to re-analyze this rug right now."
      );
      toast.error("Unable to re-analyze this rug right now.");
    } finally {
      setReAnalyzing(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto p-0">
        <div className="space-y-4 p-4 sm:p-6">
          {detail ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-primary">
                    {statusLabel}
                  </span>
                  <select
                    className="h-8 rounded-full border border-border/60 bg-background px-3 text-xs"
                    value={draft?.status ?? "available"}
                    onChange={(event) =>
                      void onQuickStatusChange(
                        event.target.value as "available" | "on_hold" | "sold"
                      )
                    }
                    disabled={saving || reAnalyzing}
                  >
                    <option value="available">Available</option>
                    <option value="on_hold">On Hold</option>
                    <option value="sold">Sold</option>
                  </select>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void onReAnalyze()}
                    disabled={saving || reAnalyzing}
                  >
                    {reAnalyzing ? "Re-analyzing..." : "Re-analyze"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setEditMode((prev) => !prev)}
                    disabled={saving || reAnalyzing}
                  >
                    {editMode ? "Cancel" : "Edit"}
                  </Button>
                </div>
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
                      src={detail.primary_image_url}
                      alt={title}
                      placeholderLabel="No image available"
                    />
                  </div>
                </div>

                <div className="min-w-0 flex-1 space-y-4">
                  {detail.ai_description ? (
                    <section className="space-y-2">
                      <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-primary">
                        Description
                      </h3>
                      <p className="text-sm leading-6 text-foreground/90">{detail.ai_description}</p>
                    </section>
                  ) : null}

                  <section className="space-y-3">
                    <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-primary">
                      AI Details
                    </h3>

                    {editMode && draft ? (
                      <div className="space-y-4 rounded-lg border border-border/60 bg-background/55 p-3">
                        <div className="space-y-1">
                          <div className="flex items-center justify-between gap-2">
                            <Label htmlFor="edit-label">Label</Label>
                            {hasOverride(detail, "label") ? (
                              <button
                                type="button"
                                className="text-xs text-muted-foreground underline"
                                onClick={() => void onRevertField("label")}
                              >
                                Revert to AI
                              </button>
                            ) : null}
                          </div>
                          <Input
                            id="edit-label"
                            ref={labelInputRef}
                            value={draft.label}
                            onChange={(event) =>
                              setDraft((prev) =>
                                prev ? { ...prev, label: event.target.value } : prev
                              )
                            }
                            placeholder="Rug label"
                          />
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="space-y-1">
                            <div className="flex items-center justify-between gap-2">
                              <Label htmlFor="edit-origin">Origin</Label>
                              {hasOverride(detail, "origin") ? (
                                <button
                                  type="button"
                                  className="text-xs text-muted-foreground underline"
                                  onClick={() => void onRevertField("origin")}
                                >
                                  Revert
                                </button>
                              ) : null}
                            </div>
                            <select
                              id="edit-origin"
                              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                              value={draft.origin}
                              onChange={(event) =>
                                setDraft((prev) =>
                                  prev ? { ...prev, origin: event.target.value } : prev
                                )
                              }
                            >
                              <option value="">Let AI decide</option>
                              {ORIGIN_OPTIONS.map((option) => (
                                <option key={option} value={option}>
                                  {option}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="space-y-1">
                            <div className="flex items-center justify-between gap-2">
                              <Label htmlFor="edit-style">Style</Label>
                              {hasOverride(detail, "style") ? (
                                <button
                                  type="button"
                                  className="text-xs text-muted-foreground underline"
                                  onClick={() => void onRevertField("style")}
                                >
                                  Revert
                                </button>
                              ) : null}
                            </div>
                            <Input
                              id="edit-style"
                              value={draft.style}
                              onChange={(event) =>
                                setDraft((prev) =>
                                  prev ? { ...prev, style: event.target.value } : prev
                                )
                              }
                              placeholder="e.g. Heriz"
                            />
                          </div>
                        </div>

                        <div className="space-y-1">
                          <div className="flex items-center justify-between gap-2">
                            <Label>Pattern</Label>
                            {hasOverride(detail, "pattern") ? (
                              <button
                                type="button"
                                className="text-xs text-muted-foreground underline"
                                onClick={() => void onRevertField("pattern")}
                              >
                                Revert
                              </button>
                            ) : null}
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {PATTERN_OPTIONS.map((option) => {
                              const active = draft.pattern.includes(option);
                              return (
                                <button
                                  key={option}
                                  type="button"
                                  className={
                                    active
                                      ? "rounded-full border border-primary/35 bg-primary/10 px-2.5 py-1 text-xs text-foreground"
                                      : "rounded-full border border-border/60 bg-background px-2.5 py-1 text-xs text-muted-foreground"
                                  }
                                  onClick={() => onToggleListValue("pattern", option)}
                                >
                                  {option}
                                </button>
                              );
                            })}
                          </div>
                          <div className="flex gap-2">
                            <Input
                              value={patternInput}
                              onChange={(event) => setPatternInput(event.target.value)}
                              placeholder="Add custom pattern"
                            />
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => onAddCustomListValue("pattern")}
                            >
                              Add
                            </Button>
                          </div>
                        </div>

                        <div className="space-y-1">
                          <div className="flex items-center justify-between gap-2">
                            <Label>Colors</Label>
                            {hasOverride(detail, "primary_colors") ? (
                              <button
                                type="button"
                                className="text-xs text-muted-foreground underline"
                                onClick={() => void onRevertField("primary_colors")}
                              >
                                Revert
                              </button>
                            ) : null}
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {COLOR_OPTIONS.map((option) => {
                              const active = draft.primary_colors.includes(option);
                              return (
                                <button
                                  key={option}
                                  type="button"
                                  className={
                                    active
                                      ? "rounded-full border border-primary/35 bg-primary/10 px-2.5 py-1 text-xs text-foreground"
                                      : "rounded-full border border-border/60 bg-background px-2.5 py-1 text-xs text-muted-foreground"
                                  }
                                  onClick={() => onToggleListValue("primary_colors", option)}
                                >
                                  {option}
                                </button>
                              );
                            })}
                          </div>
                          <div className="flex gap-2">
                            <Input
                              value={colorInput}
                              onChange={(event) => setColorInput(event.target.value)}
                              placeholder="Add custom color"
                            />
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => onAddCustomListValue("primary_colors")}
                            >
                              Add
                            </Button>
                          </div>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="space-y-1">
                            <div className="flex items-center justify-between gap-2">
                              <Label htmlFor="edit-age">Age Category</Label>
                              {hasOverride(detail, "age_category") ? (
                                <button
                                  type="button"
                                  className="text-xs text-muted-foreground underline"
                                  onClick={() => void onRevertField("age_category")}
                                >
                                  Revert
                                </button>
                              ) : null}
                            </div>
                            <select
                              id="edit-age"
                              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                              value={draft.age_category}
                              onChange={(event) =>
                                setDraft((prev) =>
                                  prev ? { ...prev, age_category: event.target.value } : prev
                                )
                              }
                            >
                              <option value="">Let AI decide</option>
                              {AGE_OPTIONS.map((option) => (
                                <option key={option} value={option}>
                                  {option}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="space-y-1">
                            <div className="flex items-center justify-between gap-2">
                              <Label htmlFor="edit-mood">Mood</Label>
                              {hasOverride(detail, "mood") ? (
                                <button
                                  type="button"
                                  className="text-xs text-muted-foreground underline"
                                  onClick={() => void onRevertField("mood")}
                                >
                                  Revert
                                </button>
                              ) : null}
                            </div>
                            <select
                              id="edit-mood"
                              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                              value={draft.mood}
                              onChange={(event) =>
                                setDraft((prev) =>
                                  prev ? { ...prev, mood: event.target.value } : prev
                                )
                              }
                            >
                              <option value="">Let AI decide</option>
                              {MOOD_OPTIONS.map((option) => (
                                <option key={option} value={option}>
                                  {option}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>

                        <div className="space-y-1">
                          <Label htmlFor="edit-stock">Stock ID</Label>
                          <Input
                            id="edit-stock"
                            value={draft.stock_id}
                            onChange={(event) =>
                              setDraft((prev) =>
                                prev ? { ...prev, stock_id: event.target.value } : prev
                              )
                            }
                            placeholder="SKU-1234"
                          />
                        </div>

                        <div className="flex justify-end">
                          <Button
                            type="button"
                            onClick={() => void onSaveEdits()}
                            disabled={saving || reAnalyzing}
                          >
                            {saving ? "Saving..." : "Save Changes"}
                          </Button>
                        </div>
                      </div>
                    ) : fieldRows.length > 0 ? (
                      <div className="space-y-2 rounded-lg border border-border/60 bg-background/55 p-3">
                        {fieldRows.map((field) => (
                          <div key={field.key} className="grid grid-cols-[7rem_1fr_auto] items-start gap-2">
                            <p className="text-sm font-medium text-foreground/85">{field.label}</p>
                            <p className="text-sm text-foreground/90">{field.value}</p>
                            <span
                              className={
                                hasOverride(detail, field.key)
                                  ? "inline-flex rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-primary"
                                  : "inline-flex rounded-full border border-border/60 bg-background px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground"
                              }
                            >
                              {hasOverride(detail, field.key) ? "Edited" : "AI"}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        AI processing pending - check back shortly.
                      </p>
                    )}
                  </section>
                </div>
              </div>

              {error ? (
                <p className="text-sm text-destructive">{error}</p>
              ) : null}

              {loading ? (
                <p className="text-sm text-muted-foreground">Refreshing details...</p>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No rug selected.</p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Close
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
