"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RugImage } from "@/components/ui/rug-image";
import { toast } from "sonner";
import { Pencil, RefreshCw } from "lucide-react";
import {
  fetchStaffRugDetail,
  patchStaffRugDetail,
  reEnrichStaffRug,
} from "@/lib/inventory/staff-client";
import { resolveEffectiveFields } from "@/lib/inventory/resolve-fields";
import type {
  InventoryBrowserRow,
  StaffInventoryRugDetail,
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
  "Moroccan",
  "Central Asian",
  "Other",
] as const;

const AGE_OPTIONS = [
  "antique",
  "semi-antique",
  "vintage",
  "traditional",
  "contemporary",
  "new",
] as const;
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

function normalizeList(values: string[]): string[] {
  const unique = new Set<string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    unique.add(trimmed);
  }
  return [...unique];
}

function normalizeDraftForCompare(draft: EditDraft) {
  return {
    label: draft.label.trim(),
    origin: draft.origin.trim(),
    style: draft.style.trim(),
    pattern: [...normalizeList(draft.pattern)].sort((a, b) => a.localeCompare(b)),
    primary_colors: [...normalizeList(draft.primary_colors)].sort((a, b) =>
      a.localeCompare(b)
    ),
    age_category: draft.age_category.trim(),
    mood: draft.mood.trim(),
    stock_id: draft.stock_id.trim(),
    status: draft.status,
  };
}

function draftsEqual(left: EditDraft, right: EditDraft): boolean {
  const a = normalizeDraftForCompare(left);
  const b = normalizeDraftForCompare(right);
  return JSON.stringify(a) === JSON.stringify(b);
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
    age_category: detail.effective_fields.age_category ?? "new",
    mood: detail.effective_fields.mood ?? "traditional",
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
  const [showPatternAddInput, setShowPatternAddInput] = useState(false);
  const [showColorAddInput, setShowColorAddInput] = useState(false);
  const labelInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open || !row) return;

    const seeded = rowToDetail(row);
    setDetail(seeded);
    setDraft(detailToDraft(seeded));
    setError(null);
    setPatternInput("");
    setColorInput("");
    setShowPatternAddInput(false);
    setShowColorAddInput(false);
    setEditMode(false);

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
    if (editMode) return;
    setPatternInput("");
    setColorInput("");
    setShowPatternAddInput(false);
    setShowColorAddInput(false);
  }, [editMode]);

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
  const baselineDraft = useMemo(() => (detail ? detailToDraft(detail) : null), [detail]);
  const hasUnsavedChanges =
    editMode && draft && baselineDraft ? !draftsEqual(draft, baselineDraft) : false;

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
      setShowPatternAddInput(false);
    } else {
      setColorInput("");
      setShowColorAddInput(false);
    }
  };

  const onSaveEdits = async (): Promise<boolean> => {
    if (!detail || !draft || saving) return false;

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
      return true;
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Unable to save changes right now."
      );
      return false;
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

  const onAvailabilityToggle = async (nextAvailable: boolean) => {
    if (!detail || saving || reAnalyzing) return;
    const currentAvailable = detail.status === "available";
    if (currentAvailable === nextAvailable) return;
    await onQuickStatusChange(nextAvailable ? "available" : "on_hold");
  };

  const onRequestClose = async () => {
    if (saving) return;
    if (!hasUnsavedChanges) {
      setEditMode(false);
      onClose();
      return;
    }

    const shouldSave = window.confirm(
      "You have unsaved changes.\n\nPress OK to Save and close.\nPress Cancel for discard options."
    );
    if (shouldSave) {
      const saved = await onSaveEdits();
      if (saved) onClose();
      return;
    }

    const shouldDiscard = window.confirm("Discard unsaved changes and close?");
    if (!shouldDiscard) return;
    if (detail) {
      setDraft(detailToDraft(detail));
    }
    setEditMode(false);
    onClose();
  };

  const onToggleEditMode = async () => {
    if (!editMode) {
      setEditMode(true);
      return;
    }
    if (!hasUnsavedChanges) {
      setEditMode(false);
      return;
    }
    const shouldSave = window.confirm(
      "You have unsaved changes.\n\nPress OK to Save.\nPress Cancel for discard options."
    );
    if (shouldSave) {
      await onSaveEdits();
      return;
    }
    const shouldDiscard = window.confirm("Discard unsaved changes?");
    if (!shouldDiscard) return;
    if (detail) {
      setDraft(detailToDraft(detail));
    }
    setEditMode(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          void onRequestClose();
        }
      }}
    >
      <DialogContent className="max-h-[92dvh] max-w-5xl overflow-hidden border-border/70 bg-card/96 p-0 shadow-[0_18px_46px_rgba(31,18,6,0.2)] backdrop-blur supports-[backdrop-filter]:bg-card/90">
        <div className="flex max-h-[92dvh] flex-col">
          <div
            className={
              editMode
                ? "flex-1 space-y-4 overflow-y-auto p-4 pb-24 sm:p-6 sm:pb-28"
                : "flex-1 space-y-4 overflow-y-auto p-4 sm:p-6"
            }
          >
          {detail ? (
            <>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="inline-flex rounded-full border border-border/60 bg-background p-0.5">
                    <button
                      type="button"
                      className={
                        detail.status === "available"
                          ? "rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800 ring-1 ring-emerald-200"
                          : "rounded-full px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-accent"
                      }
                      onClick={() => void onAvailabilityToggle(true)}
                      disabled={saving || reAnalyzing}
                    >
                      Available
                    </button>
                    <button
                      type="button"
                      className={
                        detail.status !== "available"
                          ? "rounded-full bg-rose-100 px-3 py-1 text-xs font-semibold text-rose-800 ring-1 ring-rose-200"
                          : "rounded-full px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-accent"
                      }
                      onClick={() => void onAvailabilityToggle(false)}
                      disabled={saving || reAnalyzing}
                    >
                      Not Available
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-2 self-end">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2.5 text-xs"
                    onClick={() => void onReAnalyze()}
                    disabled={saving || reAnalyzing}
                    aria-label="Re-analyze"
                  >
                    <RefreshCw className={reAnalyzing ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
                    <span className="hidden sm:inline">
                      {reAnalyzing ? "Re-analyzing..." : "Re-analyze"}
                    </span>
                  </Button>
                  {editMode ? (
                    <span className="inline-flex rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs font-semibold text-foreground">
                      Editing
                    </span>
                  ) : null}
                  <Button
                    type="button"
                    variant={editMode ? "secondary" : "outline"}
                    size="icon"
                    onClick={() => void onToggleEditMode()}
                    disabled={saving || reAnalyzing}
                    aria-label={editMode ? "Exit edit mode" : "Edit fields"}
                    title={editMode ? "Exit edit mode" : "Edit fields"}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <DialogHeader>
                <DialogTitle className="font-serif text-[2rem] leading-tight sm:text-[2.15rem]">{title}</DialogTitle>
                <DialogDescription className="italic text-foreground/75">
                  Size: {sizeLabel ?? "Unknown size"}
                </DialogDescription>
              </DialogHeader>

              <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
                <div className="shrink-0 sm:w-52">
                  <div className="aspect-[3/4] max-h-56 overflow-hidden rounded-xl border border-border/65 bg-muted sm:max-h-none">
                    <RugImage
                      src={detail.primary_image_url}
                      alt={title}
                      placeholderLabel="No image available"
                    />
                  </div>
                </div>

                <div className="min-w-0 flex-1 space-y-4">
                  {detail.ai_description ? (
                    <section className="space-y-2 rounded-xl border border-border/55 bg-background/45 p-3">
                      <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-primary">
                        Description
                      </h3>
                      <p className="text-sm leading-6 text-foreground/90">{detail.ai_description}</p>
                    </section>
                  ) : null}

                  <section className="space-y-2 rounded-xl border border-border/55 bg-background/45 p-3">
                    <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-primary">
                      Inventory
                    </h3>
                    <div className="rounded-lg border border-border/55 bg-background/70 p-3">
                      <div className="grid gap-2 sm:grid-cols-[7rem_1fr] sm:items-center">
                        <p className="text-sm font-medium text-foreground/85">Stock ID</p>
                        {editMode && draft ? (
                          <Input
                            id="edit-stock"
                            value={draft.stock_id}
                            onChange={(event) =>
                              setDraft((prev) =>
                                prev ? { ...prev, stock_id: event.target.value } : prev
                              )
                            }
                            placeholder="SKU-1234"
                            className="h-9 max-w-xs"
                          />
                        ) : (
                          <p className="text-sm text-foreground/90">
                            {detail.stock_id ? (
                              <span className="font-mono text-xs">{detail.stock_id}</span>
                            ) : (
                              "—"
                            )}
                          </p>
                        )}
                      </div>
                    </div>
                  </section>

                  <section className="space-y-3 rounded-xl border border-border/55 bg-background/45 p-3">
                    <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-primary">
                      Details
                    </h3>

                    {draft ? (
                      <div className="space-y-3 rounded-lg border border-border/55 bg-background/75 p-3">
                        <div className="grid gap-2 sm:grid-cols-[7rem_1fr] sm:items-start">
                          <Label htmlFor="edit-label" className="text-sm font-medium text-foreground/85">
                            Label
                          </Label>
                          {editMode ? (
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
                          ) : (
                            <p className="text-sm text-foreground/90">
                              {detail.effective_fields.label ?? "—"}
                            </p>
                          )}
                        </div>

                        <div className="grid gap-2 sm:grid-cols-[7rem_1fr] sm:items-start">
                          <Label htmlFor="edit-origin" className="text-sm font-medium text-foreground/85">
                            Origin
                          </Label>
                          {editMode ? (
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
                              {draft.origin && !ORIGIN_OPTIONS.includes(draft.origin as (typeof ORIGIN_OPTIONS)[number]) ? (
                                <option value={draft.origin}>{draft.origin}</option>
                              ) : null}
                              {ORIGIN_OPTIONS.map((option) => (
                                <option key={option} value={option}>
                                  {option}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <p className="text-sm text-foreground/90">
                              {detail.effective_fields.origin ?? "—"}
                            </p>
                          )}
                        </div>

                        <div className="grid gap-2 sm:grid-cols-[7rem_1fr] sm:items-start">
                          <Label htmlFor="edit-style" className="text-sm font-medium text-foreground/85">
                            Style
                          </Label>
                          {editMode ? (
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
                          ) : (
                            <p className="text-sm text-foreground/90">
                              {detail.effective_fields.style ?? "—"}
                            </p>
                          )}
                        </div>

                        <div className="grid gap-2 sm:grid-cols-[7rem_1fr] sm:items-start">
                          <p className="text-sm font-medium text-foreground/85">Pattern</p>
                          {editMode ? (
                            <div className="space-y-2">
                              <div className="flex flex-wrap gap-1.5">
                                {PATTERN_OPTIONS.map((option) => {
                                  const active = draft.pattern.includes(option);
                                  return (
                                    <button
                                      key={option}
                                      type="button"
                                      className={
                                        active
                                          ? "rounded-full border border-primary/70 bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground shadow-sm"
                                          : "rounded-full border border-border/60 bg-background px-2.5 py-1 text-xs text-muted-foreground"
                                      }
                                      onClick={() => onToggleListValue("pattern", option)}
                                    >
                                      {option}
                                    </button>
                                  );
                                })}
                                <button
                                  type="button"
                                  className="rounded-full border border-dashed border-border/70 bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground hover:border-primary/45 hover:bg-primary/10 hover:text-foreground"
                                  onClick={() => setShowPatternAddInput((prev) => !prev)}
                                >
                                  {showPatternAddInput ? "Done" : "+ Add"}
                                </button>
                              </div>
                              {showPatternAddInput ? (
                                <div className="flex flex-wrap gap-2">
                                  <Input
                                    value={patternInput}
                                    onChange={(event) => setPatternInput(event.target.value)}
                                    onKeyDown={(event) => {
                                      if (event.key !== "Enter") return;
                                      event.preventDefault();
                                      onAddCustomListValue("pattern");
                                    }}
                                    placeholder="Custom pattern"
                                    className="h-9 min-w-[14rem] flex-1"
                                  />
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => onAddCustomListValue("pattern")}
                                  >
                                    Add
                                  </Button>
                                </div>
                              ) : null}
                            </div>
                          ) : (
                            <p className="text-sm text-foreground/90">
                              {formatList(detail.effective_fields.pattern)}
                            </p>
                          )}
                        </div>

                        <div className="grid gap-2 sm:grid-cols-[7rem_1fr] sm:items-start">
                          <p className="text-sm font-medium text-foreground/85">Colors</p>
                          {editMode ? (
                            <div className="space-y-2">
                              <div className="flex flex-wrap gap-1.5">
                                {COLOR_OPTIONS.map((option) => {
                                  const active = draft.primary_colors.includes(option);
                                  return (
                                    <button
                                      key={option}
                                      type="button"
                                      className={
                                        active
                                          ? "rounded-full border border-primary/70 bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground shadow-sm"
                                          : "rounded-full border border-border/60 bg-background px-2.5 py-1 text-xs text-muted-foreground"
                                      }
                                      onClick={() => onToggleListValue("primary_colors", option)}
                                    >
                                      {option}
                                    </button>
                                  );
                                })}
                                <button
                                  type="button"
                                  className="rounded-full border border-dashed border-border/70 bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground hover:border-primary/45 hover:bg-primary/10 hover:text-foreground"
                                  onClick={() => setShowColorAddInput((prev) => !prev)}
                                >
                                  {showColorAddInput ? "Done" : "+ Add"}
                                </button>
                              </div>
                              {showColorAddInput ? (
                                <div className="flex flex-wrap gap-2">
                                  <Input
                                    value={colorInput}
                                    onChange={(event) => setColorInput(event.target.value)}
                                    onKeyDown={(event) => {
                                      if (event.key !== "Enter") return;
                                      event.preventDefault();
                                      onAddCustomListValue("primary_colors");
                                    }}
                                    placeholder="Custom color"
                                    className="h-9 min-w-[14rem] flex-1"
                                  />
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => onAddCustomListValue("primary_colors")}
                                  >
                                    Add
                                  </Button>
                                </div>
                              ) : null}
                            </div>
                          ) : (
                            <p className="text-sm text-foreground/90">
                              {formatList(detail.effective_fields.primary_colors)}
                            </p>
                          )}
                        </div>

                        <div className="grid gap-2 sm:grid-cols-[7rem_1fr] sm:items-start">
                          <Label htmlFor="edit-age" className="text-sm font-medium text-foreground/85">
                            Age
                          </Label>
                          {editMode ? (
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
                              {AGE_OPTIONS.map((option) => (
                                <option key={option} value={option}>
                                  {option}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <p className="text-sm text-foreground/90">
                              {detail.effective_fields.age_category ?? "—"}
                            </p>
                          )}
                        </div>

                        <div className="grid gap-2 sm:grid-cols-[7rem_1fr] sm:items-start">
                          <Label htmlFor="edit-mood" className="text-sm font-medium text-foreground/85">
                            Mood
                          </Label>
                          {editMode ? (
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
                              {MOOD_OPTIONS.map((option) => (
                                <option key={option} value={option}>
                                  {option}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <p className="text-sm text-foreground/90">
                              {detail.effective_fields.mood ?? "—"}
                            </p>
                          )}
                        </div>
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
          </div>
          {editMode ? (
            <div className="border-t border-border/60 bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/85 sm:px-6">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">
                  {hasUnsavedChanges ? "Unsaved changes" : "No changes yet"}
                </p>
                <Button
                  type="button"
                  onClick={() => void onSaveEdits()}
                  disabled={saving || reAnalyzing || !hasUnsavedChanges}
                >
                  {saving ? "Saving..." : "Save Changes"}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
