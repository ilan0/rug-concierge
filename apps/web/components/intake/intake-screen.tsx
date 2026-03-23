"use client";

import Link from "next/link";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { Camera, Trash2, Upload, X } from "lucide-react";
import { AppShell } from "@/components/ui/app-shell";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  createInventoryIntake,
  IntakeRequestError,
} from "@/lib/intake/client";
import {
  parseDimensionField,
  validateDimensionTuple,
} from "@/lib/intake/validation";
import type { IntakeCreatedRug } from "@/lib/types/intake";
import { cn } from "@/lib/utils";

type IntakeScreenProps = {
  tenantId: string;
};

type IntakeMode = "single" | "batch";

type IntakeFieldErrors = {
  photo: string | null;
  widthFt: string | null;
  widthIn: string | null;
  lengthFt: string | null;
  lengthIn: string | null;
  width: string | null;
  length: string | null;
};

type BatchItemState =
  | "queued"
  | "uploading"
  | "created"
  | "duplicate_rejected"
  | "error";

type BatchItem = {
  id: string;
  file: File;
  previewUrl: string;
  hash: string | null;
  stockId: string;
  overrideDimensions: boolean;
  overrideWidthFt: string;
  overrideWidthIn: string;
  overrideLengthFt: string;
  overrideLengthIn: string;
  localDuplicate: boolean;
  localDuplicateOfId: string | null;
  state: BatchItemState;
  message: string | null;
  createdRug: IntakeCreatedRug | null;
};

type BatchSummary = {
  total: number;
  created: number;
  duplicateRejected: number;
  errors: number;
};

const BATCH_LIMIT = 20;
const BATCH_UPLOAD_CONCURRENCY = 3;

const EMPTY_FIELD_ERRORS: IntakeFieldErrors = {
  photo: null,
  widthFt: null,
  widthIn: null,
  lengthFt: null,
  lengthIn: null,
  width: null,
  length: null,
};

function createBatchItemId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function hashFileSha256(file: File): Promise<string | null> {
  if (typeof crypto === "undefined" || !crypto.subtle) return null;
  try {
    const bytes = await file.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const view = new Uint8Array(digest);
    return [...view].map((value) => value.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

function parseDimensionsFromStrings(input: {
  widthFt: string;
  widthIn: string;
  lengthFt: string;
  lengthIn: string;
  contextLabel: string;
}):
  | {
      ok: true;
      value: {
        widthFt: number;
        widthIn: number;
        lengthFt: number;
        lengthIn: number;
      };
    }
  | { ok: false; error: string } {
  const parsedWidthFt = parseDimensionField(input.widthFt, "width_ft");
  if (parsedWidthFt === null) {
    return { ok: false, error: `${input.contextLabel}: invalid width feet.` };
  }

  const parsedWidthIn = parseDimensionField(input.widthIn, "width_in");
  if (parsedWidthIn === null) {
    return { ok: false, error: `${input.contextLabel}: invalid width inches.` };
  }

  const parsedLengthFt = parseDimensionField(input.lengthFt, "length_ft");
  if (parsedLengthFt === null) {
    return { ok: false, error: `${input.contextLabel}: invalid length feet.` };
  }

  const parsedLengthIn = parseDimensionField(input.lengthIn, "length_in");
  if (parsedLengthIn === null) {
    return { ok: false, error: `${input.contextLabel}: invalid length inches.` };
  }

  const validated = validateDimensionTuple({
    widthFt: parsedWidthFt,
    widthIn: parsedWidthIn,
    lengthFt: parsedLengthFt,
    lengthIn: parsedLengthIn,
  });
  if (!validated.ok) {
    return { ok: false, error: `${input.contextLabel}: ${validated.error}` };
  }

  return {
    ok: true,
    value: {
      widthFt: validated.value.widthFt,
      widthIn: validated.value.widthIn,
      lengthFt: validated.value.lengthFt,
      lengthIn: validated.value.lengthIn,
    },
  };
}

function recomputeLocalDuplicateFlags(items: BatchItem[]): BatchItem[] {
  const firstByHash = new Map<string, string>();

  return items.map((item) => {
    if (!item.hash) {
      return {
        ...item,
        localDuplicate: false,
        localDuplicateOfId: null,
      };
    }

    const first = firstByHash.get(item.hash);
    if (!first) {
      firstByHash.set(item.hash, item.id);
      return {
        ...item,
        localDuplicate: false,
        localDuplicateOfId: null,
      };
    }

    return {
      ...item,
      localDuplicate: true,
      localDuplicateOfId: first,
    };
  });
}

function batchStateLabel(state: BatchItemState): string {
  if (state === "queued") return "Queued";
  if (state === "uploading") return "Uploading";
  if (state === "created") return "Created";
  if (state === "duplicate_rejected") return "Duplicate";
  return "Error";
}

function batchStateTone(state: BatchItemState): string {
  if (state === "created") return "bg-emerald-100 text-emerald-800 border-emerald-200";
  if (state === "uploading") return "bg-amber-100 text-amber-800 border-amber-200";
  if (state === "duplicate_rejected") return "bg-orange-100 text-orange-800 border-orange-200";
  if (state === "error") return "bg-red-100 text-red-800 border-red-200";
  return "bg-secondary text-foreground/80 border-border/60";
}

function formatFeetAndInches(totalIn: number): string {
  const feet = Math.floor(totalIn / 12);
  const inches = totalIn % 12;
  if (inches === 0) return `${feet}'`;
  return `${feet}'${inches}"`;
}

function formatDuplicateMessage(error: IntakeRequestError): string {
  if (!error.existingRug) {
    return "Duplicate detected: this exact image already exists in inventory.";
  }
  if (error.existingRug.label) {
    return `Duplicate detected: matches "${error.existingRug.label}".`;
  }
  return `Duplicate detected: matches rug ${error.existingRug.id}.`;
}

export function IntakeScreen({ tenantId }: IntakeScreenProps) {
  const [mode, setMode] = useState<IntakeMode>("single");

  const [widthFt, setWidthFt] = useState("");
  const [widthIn, setWidthIn] = useState("");
  const [lengthFt, setLengthFt] = useState("");
  const [lengthIn, setLengthIn] = useState("");
  const [stockId, setStockId] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] =
    useState<IntakeFieldErrors>(EMPTY_FIELD_ERRORS);
  const [notice, setNotice] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<IntakeCreatedRug | null>(null);

  const [batchItems, setBatchItems] = useState<BatchItem[]>([]);
  const [batchWidthFt, setBatchWidthFt] = useState("");
  const [batchWidthIn, setBatchWidthIn] = useState("");
  const [batchLengthFt, setBatchLengthFt] = useState("");
  const [batchLengthIn, setBatchLengthIn] = useState("");
  const [isBatchSubmitting, setIsBatchSubmitting] = useState(false);
  const [batchError, setBatchError] = useState<string | null>(null);
  const [batchNotice, setBatchNotice] = useState<string | null>(null);
  const [batchSummary, setBatchSummary] = useState<BatchSummary | null>(null);

  const [touchPreferred, setTouchPreferred] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const batchFileInputRef = useRef<HTMLInputElement | null>(null);
  const batchItemsRef = useRef<BatchItem[]>([]);

  const imagePreviewUrl = useMemo(
    () => (imageFile ? URL.createObjectURL(imageFile) : null),
    [imageFile]
  );

  useEffect(() => {
    return () => {
      if (imagePreviewUrl) {
        URL.revokeObjectURL(imagePreviewUrl);
      }
    };
  }, [imagePreviewUrl]);

  useEffect(() => {
    batchItemsRef.current = batchItems;
  }, [batchItems]);

  useEffect(() => {
    return () => {
      for (const item of batchItemsRef.current) {
        URL.revokeObjectURL(item.previewUrl);
      }
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(pointer: coarse)");
    const sync = () => setTouchPreferred(mq.matches);
    sync();
    if (typeof mq.addEventListener === "function") {
      mq.addEventListener("change", sync);
      return () => mq.removeEventListener("change", sync);
    }
    mq.addListener(sync);
    return () => mq.removeListener(sync);
  }, []);

  const clearImage = () => {
    setImageFile(null);
    setFieldErrors((prev) => ({ ...prev, photo: null }));
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const clearFormAfterSave = () => {
    clearImage();
    setStockId("");
    setFieldErrors(EMPTY_FIELD_ERRORS);
  };

  const clearBatchItems = () => {
    setBatchItems((prev) => {
      for (const item of prev) {
        URL.revokeObjectURL(item.previewUrl);
      }
      return [];
    });
    if (batchFileInputRef.current) {
      batchFileInputRef.current.value = "";
    }
  };

  const removeBatchItem = (id: string) => {
    setBatchItems((prev) => {
      const target = prev.find((item) => item.id === id);
      if (target) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return recomputeLocalDuplicateFlags(prev.filter((item) => item.id !== id));
    });
  };

  const validateInputs = () => {
    const nextFieldErrors: IntakeFieldErrors = { ...EMPTY_FIELD_ERRORS };

    const parsedWidthFt = parseDimensionField(widthFt, "width_ft");
    const parsedWidthIn = parseDimensionField(widthIn, "width_in");
    const parsedLengthFt = parseDimensionField(lengthFt, "length_ft");
    const parsedLengthIn = parseDimensionField(lengthIn, "length_in");

    if (!imageFile) {
      nextFieldErrors.photo = "Photo is required.";
    }
    if (parsedWidthFt === null) {
      nextFieldErrors.widthFt = "Enter width feet (0-99).";
    }
    if (parsedWidthIn === null) {
      nextFieldErrors.widthIn = "Enter width inches (0-11).";
    }
    if (parsedLengthFt === null) {
      nextFieldErrors.lengthFt = "Enter length feet (0-99).";
    }
    if (parsedLengthIn === null) {
      nextFieldErrors.lengthIn = "Enter length inches (0-11).";
    }
    if (parsedWidthFt === null || parsedWidthIn === null) {
      nextFieldErrors.width = "Enter width using whole feet and inches.";
    }
    if (parsedLengthFt === null || parsedLengthIn === null) {
      nextFieldErrors.length = "Enter length using whole feet and inches.";
    }
    if (parsedWidthFt !== null && parsedWidthIn !== null) {
      const widthTotal = parsedWidthFt * 12 + parsedWidthIn;
      if (widthTotal <= 0) {
        nextFieldErrors.width = "Width must be greater than zero.";
      }
    }
    if (parsedLengthFt !== null && parsedLengthIn !== null) {
      const lengthTotal = parsedLengthFt * 12 + parsedLengthIn;
      if (lengthTotal <= 0) {
        nextFieldErrors.length = "Length must be greater than zero.";
      }
    }

    setFieldErrors(nextFieldErrors);
    if (Object.values(nextFieldErrors).some((value) => value !== null)) {
      return { ok: false } as const;
    }

    const dimensions = validateDimensionTuple({
      widthFt: parsedWidthFt,
      widthIn: parsedWidthIn,
      lengthFt: parsedLengthFt,
      lengthIn: parsedLengthIn,
    });
    if (!dimensions.ok) {
      return { ok: false } as const;
    }

    return { ok: true, value: dimensions.value } as const;
  };

  const onSubmitSingle = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSaving) return;

    const validation = validateInputs();
    if (!validation.ok) {
      setError("Please correct the highlighted fields.");
      return;
    }
    if (!imageFile) {
      setError("Please attach a photo.");
      setFieldErrors((prev) => ({ ...prev, photo: "Photo is required." }));
      return;
    }

    setIsSaving(true);
    setError(null);
    setFieldErrors(EMPTY_FIELD_ERRORS);
    setNotice(null);
    setBatchSummary(null);

    try {
      const payload = await createInventoryIntake({
        tenant_id: tenantId,
        stock_id: stockId.trim() || null,
        width_ft: validation.value.widthFt,
        width_in: validation.value.widthIn,
        length_ft: validation.value.lengthFt,
        length_in: validation.value.lengthIn,
        image: imageFile,
      });
      setLastSaved(payload.rug);
      setNotice("Rug saved. AI enrichment is running in the background.");

      clearFormAfterSave();
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Could not save intake right now."
      );
    } finally {
      setIsSaving(false);
    }
  };

  const addBatchFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files ?? []);
    event.target.value = "";

    if (selectedFiles.length === 0) return;

    setBatchError(null);
    setBatchNotice(null);
    setBatchSummary(null);

    const remainingSlots = Math.max(0, BATCH_LIMIT - batchItems.length);
    if (remainingSlots <= 0) {
      setBatchError(`Batch limit reached (${BATCH_LIMIT} photos).`);
      return;
    }

    const acceptedFiles = selectedFiles.slice(0, remainingSlots);
    if (selectedFiles.length > acceptedFiles.length) {
      setBatchNotice(
        `Batch limit is ${BATCH_LIMIT}. Added ${acceptedFiles.length} photo(s), skipped ${selectedFiles.length - acceptedFiles.length}.`
      );
    }

    const newItemsWithHash = await Promise.all(
      acceptedFiles.map(async (file) => {
        const hash = await hashFileSha256(file);
        return {
          id: createBatchItemId(),
          file,
          previewUrl: URL.createObjectURL(file),
          hash,
          stockId: "",
          overrideDimensions: false,
          overrideWidthFt: "",
          overrideWidthIn: "",
          overrideLengthFt: "",
          overrideLengthIn: "",
          localDuplicate: false,
          localDuplicateOfId: null,
          state: "queued" as const,
          message: null,
          createdRug: null,
        };
      })
    );

    setBatchItems((prev) =>
      recomputeLocalDuplicateFlags([...prev, ...newItemsWithHash])
    );
  };

  const updateBatchItem = (id: string, patch: Partial<BatchItem>) => {
    setBatchItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...patch } : item))
    );
  };

  const onSubmitBatch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isBatchSubmitting) return;

    if (batchItems.length === 0) {
      setBatchError("Please add at least one photo.");
      return;
    }

    const sharedDimensions = parseDimensionsFromStrings({
      widthFt: batchWidthFt,
      widthIn: batchWidthIn,
      lengthFt: batchLengthFt,
      lengthIn: batchLengthIn,
      contextLabel: "Shared dimensions",
    });
    if (!sharedDimensions.ok) {
      setBatchError(sharedDimensions.error);
      return;
    }

    setBatchError(null);
    setBatchNotice(null);
    setBatchSummary(null);
    setError(null);
    setNotice(null);
    setIsBatchSubmitting(true);

    const snapshot = recomputeLocalDuplicateFlags(batchItems);
    setBatchItems((prev) =>
      prev.map((item) => ({
        ...item,
        state: "queued",
        message: null,
        createdRug: null,
      }))
    );

    let created = 0;
    let duplicateRejected = 0;
    let errors = 0;

    const processBatchItem = async (item: BatchItem, index: number) => {
      if (item.localDuplicate) {
        duplicateRejected += 1;
        updateBatchItem(item.id, {
          state: "duplicate_rejected",
          message: "Duplicate in selected batch (exact same file).",
          createdRug: null,
        });
        return;
      }

      const dimensions = item.overrideDimensions
        ? parseDimensionsFromStrings({
            widthFt: item.overrideWidthFt,
            widthIn: item.overrideWidthIn,
            lengthFt: item.overrideLengthFt,
            lengthIn: item.overrideLengthIn,
            contextLabel: `Photo ${index + 1}`,
          })
        : sharedDimensions;

      if (!dimensions.ok) {
        errors += 1;
        updateBatchItem(item.id, {
          state: "error",
          message: dimensions.error,
          createdRug: null,
        });
        return;
      }

      updateBatchItem(item.id, {
        state: "uploading",
        message: null,
        createdRug: null,
      });

      try {
        const response = await createInventoryIntake({
          tenant_id: tenantId,
          stock_id: item.stockId.trim() || null,
          width_ft: dimensions.value.widthFt,
          width_in: dimensions.value.widthIn,
          length_ft: dimensions.value.lengthFt,
          length_in: dimensions.value.lengthIn,
          image: item.file,
        });

        created += 1;
        updateBatchItem(item.id, {
          state: "created",
          message: "Created and queued for AI enrichment.",
          createdRug: response.rug,
        });
      } catch (nextError) {
        if (
          nextError instanceof IntakeRequestError &&
          nextError.code?.toUpperCase() === "DUPLICATE_IMAGE"
        ) {
          duplicateRejected += 1;
          updateBatchItem(item.id, {
            state: "duplicate_rejected",
            message: formatDuplicateMessage(nextError),
            createdRug: null,
          });
          return;
        }

        errors += 1;
        updateBatchItem(item.id, {
          state: "error",
          message:
            nextError instanceof Error
              ? nextError.message
              : "Upload failed for this photo.",
          createdRug: null,
        });
      }
    };

    let nextIndex = 0;
    const workerCount = Math.min(BATCH_UPLOAD_CONCURRENCY, snapshot.length);
    const workers = Array.from({ length: workerCount }, async () => {
      while (true) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        if (currentIndex >= snapshot.length) {
          return;
        }
        await processBatchItem(snapshot[currentIndex], currentIndex);
      }
    });
    await Promise.all(workers);

    setBatchSummary({
      total: snapshot.length,
      created,
      duplicateRejected,
      errors,
    });
    setIsBatchSubmitting(false);
  };

  const onModeChange = (nextMode: IntakeMode) => {
    setMode(nextMode);
    setError(null);
    setBatchError(null);
    setNotice(null);
    setBatchNotice(null);
  };

  return (
    <AppShell>
      <PageHeader
        title="Inventory Intake"
        subtitle="Capture single rugs or upload a batch. AI enrichment runs asynchronously after each save."
      />

      <div className="mt-5 space-y-5">
        <SectionCard tone="soft">
          <div className="mb-4 inline-flex rounded-full border border-border/60 bg-background p-1">
            <button
              type="button"
              className={cn(
                "rounded-full px-4 py-1.5 text-sm font-medium",
                mode === "single"
                  ? "bg-primary text-primary-foreground"
                  : "text-foreground/75 hover:bg-secondary"
              )}
              onClick={() => onModeChange("single")}
              disabled={isSaving || isBatchSubmitting}
            >
              Single
            </button>
            <button
              type="button"
              className={cn(
                "rounded-full px-4 py-1.5 text-sm font-medium",
                mode === "batch"
                  ? "bg-primary text-primary-foreground"
                  : "text-foreground/75 hover:bg-secondary"
              )}
              onClick={() => onModeChange("batch")}
              disabled={isSaving || isBatchSubmitting}
            >
              Batch
            </button>
          </div>

          {mode === "single" ? (
            <form onSubmit={onSubmitSingle} className="space-y-5">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(event) => {
                  setImageFile(event.target.files?.[0] ?? null);
                  setError(null);
                  setFieldErrors((prev) => ({ ...prev, photo: null }));
                }}
                disabled={isSaving}
              />

              <div className="space-y-2">
                <Label>
                  Photo <span className="text-destructive">*</span>
                </Label>

                {!imagePreviewUrl ? (
                  <button
                    type="button"
                    className={cn(
                      "w-full rounded-2xl border-2 border-dashed px-4 py-8 text-center transition-colors",
                      fieldErrors.photo
                        ? "border-destructive/70 bg-destructive/5"
                        : "border-border/65 bg-background/60 hover:border-primary/45 hover:bg-primary/10"
                    )}
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isSaving}
                  >
                    <div className="mx-auto flex max-w-sm flex-col items-center gap-3 text-center">
                      <span className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                        <Camera className="size-6" />
                      </span>
                      <p className="text-lg font-semibold text-foreground">
                        {touchPreferred ? "Tap to upload a photo" : "Click to upload a photo"}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Supported formats: JPEG, PNG, WebP, HEIC
                      </p>
                    </div>
                  </button>
                ) : (
                  <div className="relative overflow-hidden rounded-2xl border border-border/70 bg-background/70">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={imagePreviewUrl}
                      alt="Selected rug"
                      className="max-h-[22rem] w-full object-cover"
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      size="icon"
                      className="absolute right-3 top-3 size-8 rounded-full"
                      onClick={clearImage}
                      disabled={isSaving}
                      aria-label="Remove selected photo"
                    >
                      <X className="size-4" />
                    </Button>
                  </div>
                )}
                {fieldErrors.photo ? (
                  <p className="text-xs text-destructive">{fieldErrors.photo}</p>
                ) : null}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>
                    Width <span className="text-destructive">*</span>
                  </Label>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="relative">
                      <Input
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={widthFt}
                        onChange={(event) => {
                          setWidthFt(event.target.value);
                          setError(null);
                          setFieldErrors((prev) => ({
                            ...prev,
                            widthFt: null,
                            width: null,
                          }));
                        }}
                        placeholder="0"
                        className={cn(
                          "h-12 pr-9 text-base",
                          fieldErrors.widthFt || fieldErrors.width
                            ? "border-destructive focus-visible:ring-destructive/60"
                            : null
                        )}
                        disabled={isSaving}
                      />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-muted-foreground">
                        ft
                      </span>
                    </div>
                    <div className="relative">
                      <Input
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={widthIn}
                        onChange={(event) => {
                          setWidthIn(event.target.value);
                          setError(null);
                          setFieldErrors((prev) => ({
                            ...prev,
                            widthIn: null,
                            width: null,
                          }));
                        }}
                        placeholder="0"
                        className={cn(
                          "h-12 pr-9 text-base",
                          fieldErrors.widthIn || fieldErrors.width
                            ? "border-destructive focus-visible:ring-destructive/60"
                            : null
                        )}
                        disabled={isSaving}
                      />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-muted-foreground">
                        in
                      </span>
                    </div>
                  </div>
                  {fieldErrors.width || fieldErrors.widthFt || fieldErrors.widthIn ? (
                    <p className="text-xs text-destructive">
                      {fieldErrors.width ?? fieldErrors.widthFt ?? fieldErrors.widthIn}
                    </p>
                  ) : null}
                </div>

                <div className="space-y-2">
                  <Label>
                    Length <span className="text-destructive">*</span>
                  </Label>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="relative">
                      <Input
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={lengthFt}
                        onChange={(event) => {
                          setLengthFt(event.target.value);
                          setError(null);
                          setFieldErrors((prev) => ({
                            ...prev,
                            lengthFt: null,
                            length: null,
                          }));
                        }}
                        placeholder="0"
                        className={cn(
                          "h-12 pr-9 text-base",
                          fieldErrors.lengthFt || fieldErrors.length
                            ? "border-destructive focus-visible:ring-destructive/60"
                            : null
                        )}
                        disabled={isSaving}
                      />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-muted-foreground">
                        ft
                      </span>
                    </div>
                    <div className="relative">
                      <Input
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={lengthIn}
                        onChange={(event) => {
                          setLengthIn(event.target.value);
                          setError(null);
                          setFieldErrors((prev) => ({
                            ...prev,
                            lengthIn: null,
                            length: null,
                          }));
                        }}
                        placeholder="0"
                        className={cn(
                          "h-12 pr-9 text-base",
                          fieldErrors.lengthIn || fieldErrors.length
                            ? "border-destructive focus-visible:ring-destructive/60"
                            : null
                        )}
                        disabled={isSaving}
                      />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-muted-foreground">
                        in
                      </span>
                    </div>
                  </div>
                  {fieldErrors.length || fieldErrors.lengthFt || fieldErrors.lengthIn ? (
                    <p className="text-xs text-destructive">
                      {fieldErrors.length ?? fieldErrors.lengthFt ?? fieldErrors.lengthIn}
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="space-y-2">
                <Label>Stock ID (optional)</Label>
                <Input
                  value={stockId}
                  onChange={(event) => {
                    setStockId(event.target.value);
                    setError(null);
                  }}
                  placeholder="e.g. HER-1082"
                  className="h-12"
                  disabled={isSaving}
                />
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Button
                  type="submit"
                  size="lg"
                  disabled={isSaving}
                >
                  {isSaving ? "Saving..." : "Add to inventory"}
                </Button>
              </div>
            </form>
          ) : (
            <form onSubmit={onSubmitBatch} className="space-y-5">
              <input
                ref={batchFileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={addBatchFiles}
                disabled={isBatchSubmitting}
              />

              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Label>
                    Photos <span className="text-destructive">*</span>
                  </Label>
                  <span className="text-xs text-muted-foreground">
                    {batchItems.length}/{BATCH_LIMIT}
                  </span>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => batchFileInputRef.current?.click()}
                    disabled={isBatchSubmitting || batchItems.length >= BATCH_LIMIT}
                  >
                    <Upload className="mr-1.5 size-4" />
                    Add Photos
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={clearBatchItems}
                    disabled={isBatchSubmitting || batchItems.length === 0}
                  >
                    Clear Batch
                  </Button>
                </div>

                {batchItems.length === 0 ? (
                  <button
                    type="button"
                    className="mt-2 w-full rounded-2xl border-2 border-dashed border-border/65 bg-background/60 px-4 py-8 text-center transition-colors hover:border-primary/45 hover:bg-primary/10"
                    onClick={() => batchFileInputRef.current?.click()}
                    disabled={isBatchSubmitting}
                  >
                    <div className="mx-auto flex max-w-sm flex-col items-center gap-3 text-center">
                      <span className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                        <Camera className="size-6" />
                      </span>
                      <p className="text-lg font-semibold text-foreground">
                        Add up to 20 rug photos
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Add the photos now, then review shared dimensions or turn on overrides for any photo that needs them.
                      </p>
                    </div>
                  </button>
                ) : null}
              </div>

              <div className="space-y-2 rounded-xl border border-border/60 bg-background/50 p-3">
                <Label>
                  Shared Dimensions for This Batch <span className="text-destructive">*</span>
                </Label>
                <p className="text-xs text-muted-foreground">
                  These sizes apply to every photo unless you turn on an override.
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="relative">
                      <Input
                        value={batchWidthFt}
                        onChange={(event) => setBatchWidthFt(event.target.value)}
                        inputMode="numeric"
                        pattern="[0-9]*"
                        placeholder="0"
                        disabled={isBatchSubmitting}
                        className="h-12 pr-9 text-base"
                      />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                        ft
                      </span>
                    </div>
                    <div className="relative">
                      <Input
                        value={batchWidthIn}
                        onChange={(event) => setBatchWidthIn(event.target.value)}
                        inputMode="numeric"
                        pattern="[0-9]*"
                        placeholder="0"
                        disabled={isBatchSubmitting}
                        className="h-12 pr-9 text-base"
                      />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                        in
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="relative">
                      <Input
                        value={batchLengthFt}
                        onChange={(event) => setBatchLengthFt(event.target.value)}
                        inputMode="numeric"
                        pattern="[0-9]*"
                        placeholder="0"
                        disabled={isBatchSubmitting}
                        className="h-12 pr-9 text-base"
                      />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                        ft
                      </span>
                    </div>
                    <div className="relative">
                      <Input
                        value={batchLengthIn}
                        onChange={(event) => setBatchLengthIn(event.target.value)}
                        inputMode="numeric"
                        pattern="[0-9]*"
                        placeholder="0"
                        disabled={isBatchSubmitting}
                        className="h-12 pr-9 text-base"
                      />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                        in
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {batchItems.length > 0 ? (
                <div className="space-y-3">
                  {batchItems.map((item, index) => (
                    <article
                      key={item.id}
                      className="rounded-xl border border-border/60 bg-background/70 p-3"
                    >
                      <div className="flex items-start gap-3">
                        <div className="h-24 w-20 shrink-0 overflow-hidden rounded-md border border-border/70 bg-muted">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={item.previewUrl}
                            alt={`Batch item ${index + 1}`}
                            className="h-full w-full object-cover"
                          />
                        </div>

                        <div className="min-w-0 flex-1 space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-medium text-foreground">Photo {index + 1}</p>
                            <span
                              className={cn(
                                "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
                                batchStateTone(item.state)
                              )}
                            >
                              {batchStateLabel(item.state)}
                            </span>
                            {item.localDuplicate ? (
                              <span className="inline-flex items-center rounded-full border border-orange-200 bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-800">
                                Local duplicate
                              </span>
                            ) : null}
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="ml-auto h-7 w-7"
                              onClick={() => removeBatchItem(item.id)}
                              disabled={isBatchSubmitting}
                              aria-label={`Remove photo ${index + 1}`}
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </div>

                          <div className="grid gap-2 sm:grid-cols-2">
                            <div className="space-y-1">
                              <Label className="text-xs">Stock ID (optional)</Label>
                              <Input
                                value={item.stockId}
                                onChange={(event) =>
                                  updateBatchItem(item.id, { stockId: event.target.value })
                                }
                                placeholder="SKU"
                                disabled={isBatchSubmitting}
                                className="h-9"
                              />
                            </div>

                              <label className="flex items-center gap-2 self-end text-sm">
                                <input
                                  type="checkbox"
                                  checked={item.overrideDimensions}
                                  onChange={(event) =>
                                    updateBatchItem(item.id, {
                                      overrideDimensions: event.target.checked,
                                    })
                                  }
                                  disabled={isBatchSubmitting}
                                />
                                Override dimensions for this photo
                              </label>
                            </div>

                          {item.overrideDimensions ? (
                            <div className="grid gap-2 sm:grid-cols-2">
                              <div className="grid grid-cols-2 gap-2">
                                <div className="relative">
                                  <Input
                                    value={item.overrideWidthFt}
                                    onChange={(event) =>
                                      updateBatchItem(item.id, {
                                        overrideWidthFt: event.target.value,
                                      })
                                    }
                                    inputMode="numeric"
                                    pattern="[0-9]*"
                                    placeholder="0"
                                    disabled={isBatchSubmitting}
                                    className="h-9 pr-9 text-sm"
                                  />
                                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                                    ft
                                  </span>
                                </div>
                                <div className="relative">
                                  <Input
                                    value={item.overrideWidthIn}
                                    onChange={(event) =>
                                      updateBatchItem(item.id, {
                                        overrideWidthIn: event.target.value,
                                      })
                                    }
                                    inputMode="numeric"
                                    pattern="[0-9]*"
                                    placeholder="0"
                                    disabled={isBatchSubmitting}
                                    className="h-9 pr-9 text-sm"
                                  />
                                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                                    in
                                  </span>
                                </div>
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                <div className="relative">
                                  <Input
                                    value={item.overrideLengthFt}
                                    onChange={(event) =>
                                      updateBatchItem(item.id, {
                                        overrideLengthFt: event.target.value,
                                      })
                                    }
                                    inputMode="numeric"
                                    pattern="[0-9]*"
                                    placeholder="0"
                                    disabled={isBatchSubmitting}
                                    className="h-9 pr-9 text-sm"
                                  />
                                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                                    ft
                                  </span>
                                </div>
                                <div className="relative">
                                  <Input
                                    value={item.overrideLengthIn}
                                    onChange={(event) =>
                                      updateBatchItem(item.id, {
                                        overrideLengthIn: event.target.value,
                                      })
                                    }
                                    inputMode="numeric"
                                    pattern="[0-9]*"
                                    placeholder="0"
                                    disabled={isBatchSubmitting}
                                    className="h-9 pr-9 text-sm"
                                  />
                                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                                    in
                                  </span>
                                </div>
                              </div>
                            </div>
                          ) : null}

                          {item.message ? (
                            <p
                              className={cn(
                                "text-xs",
                                item.state === "created"
                                  ? "text-emerald-700"
                                  : item.state === "duplicate_rejected"
                                    ? "text-orange-700"
                                    : item.state === "error"
                                      ? "text-red-700"
                                      : "text-muted-foreground"
                              )}
                            >
                              {item.message}
                            </p>
                          ) : null}
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              ) : null}

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Button
                  type="submit"
                  size="lg"
                  disabled={isBatchSubmitting || batchItems.length === 0}
                >
                  {isBatchSubmitting ? "Uploading Batch..." : "Upload Batch"}
                </Button>
                <p className="text-xs text-muted-foreground">
                  Uploads are handled in the background to keep things reliable.
                </p>
              </div>
            </form>
          )}
        </SectionCard>

        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Could not save intake</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {notice ? (
          <Alert>
            <AlertTitle>Saved</AlertTitle>
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        ) : null}

        {batchError ? (
          <Alert variant="destructive">
            <AlertTitle>Batch upload blocked</AlertTitle>
            <AlertDescription>{batchError}</AlertDescription>
          </Alert>
        ) : null}

        {batchNotice ? (
          <Alert>
            <AlertTitle>Batch notice</AlertTitle>
            <AlertDescription>{batchNotice}</AlertDescription>
          </Alert>
        ) : null}

        {batchSummary ? (
          <Alert>
            <AlertTitle>Batch complete</AlertTitle>
            <AlertDescription className="space-y-2">
              <p>
                Processed {batchSummary.total} photo(s): {batchSummary.created} created, {" "}
                {batchSummary.duplicateRejected} duplicates, {batchSummary.errors} errors.
              </p>
              <p>
                <Link
                  href="/inventory"
                  className="font-medium text-primary underline-offset-4 hover:underline"
                >
                  Open inventory
                </Link>
              </p>
            </AlertDescription>
          </Alert>
        ) : null}

        {lastSaved ? (
          <SectionCard tone="soft">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-foreground">Last saved rug</p>
                <p className="text-sm text-muted-foreground">
                  Stock ID: <span className="font-mono">{lastSaved.stock_id}</span>
                </p>
              </div>
              <div className="text-sm text-foreground">
                Size: {formatFeetAndInches(lastSaved.width_total_in)} × {" "}
                {formatFeetAndInches(lastSaved.length_total_in)}
              </div>
            </div>
          </SectionCard>
        ) : null}
      </div>
    </AppShell>
  );
}
