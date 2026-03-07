"use client";

import { useRef, useState, type FormEvent } from "react";
import { AppShell } from "@/components/ui/app-shell";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { createInventoryIntake, resolveIntakeRole } from "@/lib/intake/client";
import {
  parseDimensionField,
  validateDimensionTuple,
} from "@/lib/intake/validation";
import { getUiRole } from "@/lib/ui/role-session";
import type { IntakeCreatedRug } from "@/lib/types/intake";

type IntakeScreenProps = {
  tenantId: string;
};

export function IntakeScreen({ tenantId }: IntakeScreenProps) {
  const [intakeLabel, setIntakeLabel] = useState("");
  const [widthFt, setWidthFt] = useState("");
  const [widthIn, setWidthIn] = useState("");
  const [lengthFt, setLengthFt] = useState("");
  const [lengthIn, setLengthIn] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<IntakeCreatedRug | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const labelInputRef = useRef<HTMLInputElement | null>(null);

  const clearForNext = () => {
    setIntakeLabel("");
    setImageFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    labelInputRef.current?.focus();
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

    const trimmedLabel = intakeLabel.trim();
    const dimensions = parseDimensions();
    if (!trimmedLabel) {
      setError("Label is required.");
      return;
    }
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
        role: resolveIntakeRole(getUiRole()),
        tenant_id: tenantId,
        intake_label: trimmedLabel,
        width_ft: dimensions.value.widthFt,
        width_in: dimensions.value.widthIn,
        length_ft: dimensions.value.lengthFt,
        length_in: dimensions.value.lengthIn,
        image: imageFile,
      });
      setLastSaved(payload.rug);
      setNotice(`Saved ${payload.rug.intake_label}.`);
      clearForNext();
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
        kicker="Staff Workflow"
        title="Inventory Intake"
        subtitle="Capture a rug photo, one-line label, and dimensions to add inventory quickly."
      />

      <SectionCard>
        <div className="flex flex-wrap gap-2 text-sm">
          <Badge variant="secondary">Tenant: {tenantId}</Badge>
          <Badge variant="outline">Required: photo, label, size</Badge>
          <Badge variant="outline">Price defaults to pending</Badge>
        </div>
      </SectionCard>

      <div className="mt-5 space-y-5">
        <SectionCard title="Quick Intake">
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="intake-photo">Primary Photo</Label>
              <Input
                id="intake-photo"
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="h-12 text-base"
                onChange={(event) =>
                  setImageFile(event.target.files?.[0] ?? null)
                }
                disabled={isSaving}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="intake-label">One-line Label</Label>
              <Input
                id="intake-label"
                ref={labelInputRef}
                value={intakeLabel}
                onChange={(event) => setIntakeLabel(event.target.value)}
                placeholder="Example: 9x12 Oushak - muted ivory blue"
                className="h-12 text-base"
                disabled={isSaving}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="width-ft">Width</Label>
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    id="width-ft"
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
                <Label htmlFor="length-ft">Length</Label>
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    id="length-ft"
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

            <div className="flex flex-wrap gap-2">
              <Button type="submit" size="lg" disabled={isSaving}>
                {isSaving ? "Saving..." : "Save Rug"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="lg"
                onClick={clearForNext}
                disabled={isSaving}
              >
                Save Next Rug
              </Button>
            </div>
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
                <span className="font-medium">Label:</span> {lastSaved.intake_label}
              </p>
              <p>
                <span className="font-medium">ID:</span> {lastSaved.id}
              </p>
              <p>
                <span className="font-medium">Size:</span>{" "}
                {`${lastSaved.width_ft}'${lastSaved.width_in}" x ${lastSaved.length_ft}'${lastSaved.length_in}" (${lastSaved.width_total_in}" x ${lastSaved.length_total_in}")`}
              </p>
            </div>
          </SectionCard>
        ) : null}
      </div>
    </AppShell>
  );
}
