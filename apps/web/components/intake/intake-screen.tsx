"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { Camera, X } from "lucide-react";
import { AppShell } from "@/components/ui/app-shell";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { createInventoryIntake } from "@/lib/intake/client";
import {
  parseDimensionField,
  validateDimensionTuple,
} from "@/lib/intake/validation";
import type { IntakeCreatedRug } from "@/lib/types/intake";

type IntakeScreenProps = {
  tenantId: string;
};

type SubmitIntent = "save" | "save_and_add_another";

export function IntakeScreen({ tenantId }: IntakeScreenProps) {
  const [widthFt, setWidthFt] = useState("");
  const [widthIn, setWidthIn] = useState("");
  const [lengthFt, setLengthFt] = useState("");
  const [lengthIn, setLengthIn] = useState("");
  const [stockId, setStockId] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [submitIntent, setSubmitIntent] = useState<SubmitIntent>("save");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<IntakeCreatedRug | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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

  const formatFeetAndInches = (totalIn: number): string => {
    const feet = Math.floor(totalIn / 12);
    const inches = totalIn % 12;
    if (inches === 0) return `${feet}'`;
    return `${feet}'${inches}"`;
  };

  const clearImage = () => {
    setImageFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const clearFormForAnother = () => {
    clearImage();
    setWidthFt("");
    setWidthIn("");
    setLengthFt("");
    setLengthIn("");
    setStockId("");
  };

  const parseDimensions = () => {
    return validateDimensionTuple({
      widthFt: parseDimensionField(widthFt, "width_ft"),
      widthIn: parseDimensionField(widthIn, "width_in"),
      lengthFt: parseDimensionField(lengthFt, "length_ft"),
      lengthIn: parseDimensionField(lengthIn, "length_in"),
    });
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSaving) return;

    const dimensions = parseDimensions();
    if (!dimensions.ok) {
      setError("Enter valid feet/inches dimensions.");
      return;
    }
    if (!imageFile) {
      setError("Photo is required.");
      return;
    }

    setIsSaving(true);
    setError(null);
    setNotice(null);
    try {
      const payload = await createInventoryIntake({
        tenant_id: tenantId,
        stock_id: stockId.trim() || null,
        width_ft: dimensions.value.widthFt,
        width_in: dimensions.value.widthIn,
        length_ft: dimensions.value.lengthFt,
        length_in: dimensions.value.lengthIn,
        image: imageFile,
      });
      setLastSaved(payload.rug);
      setNotice("Rug saved — AI is generating the label and description.");

      if (submitIntent === "save_and_add_another") {
        clearFormForAnother();
      } else {
        clearImage();
      }
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

  return (
    <AppShell>
      <PageHeader
        title="Inventory Intake"
        subtitle="Capture a photo and dimensions. AI will auto-generate the name and description."
      />

      <div className="mt-5 space-y-5">
        <SectionCard>
          <form onSubmit={onSubmit} className="space-y-6">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(event) => setImageFile(event.target.files?.[0] ?? null)}
              disabled={isSaving}
            />

            <div className="space-y-2">
              <Label>
                Photo <span className="text-destructive">*</span>
              </Label>

              {!imagePreviewUrl ? (
                <button
                  type="button"
                  className="w-full rounded-2xl border-2 border-dashed border-border/65 bg-background/60 px-4 py-10 text-center transition-colors hover:border-primary/45 hover:bg-primary/10"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isSaving}
                >
                  <div className="mx-auto flex max-w-sm flex-col items-center gap-3 text-center">
                    <span className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <Camera className="size-6" />
                    </span>
                    <p className="text-lg font-semibold text-foreground">Tap to take a photo</p>
                    <p className="text-sm text-muted-foreground">
                      Or choose one from the photo library
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
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>
                  Width <span className="text-destructive">*</span>
                </Label>
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={widthFt}
                    onChange={(event) => setWidthFt(event.target.value)}
                    placeholder="ft"
                    className="h-12 text-base"
                    disabled={isSaving}
                  />
                  <Input
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={widthIn}
                    onChange={(event) => setWidthIn(event.target.value)}
                    placeholder="in"
                    className="h-12 text-base"
                    disabled={isSaving}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>
                  Length <span className="text-destructive">*</span>
                </Label>
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={lengthFt}
                    onChange={(event) => setLengthFt(event.target.value)}
                    placeholder="ft"
                    className="h-12 text-base"
                    disabled={isSaving}
                  />
                  <Input
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={lengthIn}
                    onChange={(event) => setLengthIn(event.target.value)}
                    placeholder="in"
                    className="h-12 text-base"
                    disabled={isSaving}
                  />
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="stock-id">Stock ID (optional)</Label>
              <Input
                id="stock-id"
                value={stockId}
                onChange={(event) => setStockId(event.target.value)}
                placeholder="e.g. SKU-1234"
                className="h-12 text-base"
                maxLength={80}
                disabled={isSaving}
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                type="submit"
                size="lg"
                onClick={() => setSubmitIntent("save")}
                disabled={isSaving}
              >
                {isSaving && submitIntent === "save" ? "Saving..." : "Save Rug"}
              </Button>
              <Button
                type="submit"
                variant="outline"
                size="lg"
                onClick={() => setSubmitIntent("save_and_add_another")}
                disabled={isSaving}
              >
                {isSaving && submitIntent === "save_and_add_another"
                  ? "Saving..."
                  : "Save & Add Another"}
              </Button>
            </div>

            <p className="text-sm text-muted-foreground">
              AI will auto-generate name and description from the photo.
            </p>
          </form>
        </SectionCard>

        {notice ? (
          <Alert>
            <AlertTitle>Saved</AlertTitle>
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        ) : null}

        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Intake failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {lastSaved ? (
          <SectionCard title="Last Saved Rug">
            <div className="space-y-1 text-sm">
              <p>
                <span className="font-medium">Label:</span>{" "}
                {lastSaved.intake_label ?? "Processing..."}
              </p>
              {lastSaved.stock_id ? (
                <p>
                  <span className="font-medium">Stock ID:</span> {lastSaved.stock_id}
                </p>
              ) : null}
              <p>
                <span className="font-medium">ID:</span> {lastSaved.id}
              </p>
              <p>
                <span className="font-medium">Size:</span>{" "}
                {`${formatFeetAndInches(lastSaved.width_total_in)} × ${formatFeetAndInches(lastSaved.length_total_in)}`}
              </p>
              <p>
                <span className="font-medium">Description:</span>{" "}
                {lastSaved.ai_description ?? "Pending"}
              </p>
            </div>
          </SectionCard>
        ) : null}
      </div>
    </AppShell>
  );
}
