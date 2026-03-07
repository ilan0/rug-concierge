"use client";

import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import {
  copyTextToClipboard,
  downloadTextFile,
  generateAppraisalDraftClient,
  listAppraisalDraftsClient,
  listAppraisalRugsClient,
  saveAppraisalDraftClient,
} from "@/lib/appraisal/client";
import type {
  AppraisalDraftListItem,
  AppraisalGenerateResponse,
  AppraisalRugSearchRow,
  AppraisalStatus,
} from "@/lib/types/appraisal";
import type { AppraisalUiResult, AppraisalFormState } from "@/lib/types/appraisal-ui";
import { applyDraftToForm, applyRugToForm, toAppraisalInput } from "@/lib/types/appraisal-ui";
import { AppShell } from "@/components/ui/app-shell";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

const todayDate = () => new Date().toISOString().slice(0, 10);

const DEFAULT_FORM: AppraisalFormState = {
  source_type: "customer_owned",
  status: "draft",
  appraisal_id: "",
  rug_id: "",
  external_rug_label: "",
  customer_name: "",
  customer_phone: "",
  customer_email: "",
  customer_address_line1: "",
  customer_address_line2: "",
  customer_city: "",
  customer_state: "",
  customer_postal_code: "",
  customer_country: "",
  appraisal_date: todayDate(),
  appraised_value: "",
  condition: "",
  condition_notes: "",
  rug_type_label: "",
  origin_country: "",
  region: "",
  age_category: "",
  construction: "",
  foundation: "",
  pile_material: "",
  width_ft: "",
  width_in: "",
  length_ft: "",
  length_in: "",
  rug_size_text: "",
  dominant_colors: "",
  design_motifs: "",
  style: "",
  palette: "",
  staff_notes: "",
};

type AppraisalScreenProps = {
  tenantId: string;
};

type MissingFieldItem = {
  key: string;
  label: string;
  inputId: string;
  optional: boolean;
  underMoreDetails: boolean;
};

const MISSING_FIELD_MAP: Record<string, MissingFieldItem> = {
  rug_type_label: {
    key: "rug_type_label",
    label: "Rug label or type",
    inputId: "rug-type-label",
    optional: false,
    underMoreDetails: true,
  },
  condition: {
    key: "condition",
    label: "Condition",
    inputId: "essential-condition",
    optional: false,
    underMoreDetails: false,
  },
  appraised_value: {
    key: "appraised_value",
    label: "Appraised value",
    inputId: "essential-appraised-value",
    optional: false,
    underMoreDetails: false,
  },
  appraisal_date: {
    key: "appraisal_date",
    label: "Appraisal date",
    inputId: "essential-appraisal-date",
    optional: false,
    underMoreDetails: false,
  },
  origin_country: {
    key: "origin_country",
    label: "Origin country",
    inputId: "origin-country",
    optional: true,
    underMoreDetails: true,
  },
  construction: {
    key: "construction",
    label: "Construction",
    inputId: "construction",
    optional: true,
    underMoreDetails: true,
  },
  pile_material: {
    key: "pile_material",
    label: "Pile material",
    inputId: "pile-material",
    optional: true,
    underMoreDetails: true,
  },
  dominant_colors: {
    key: "dominant_colors",
    label: "Dominant colors",
    inputId: "dominant-colors",
    optional: true,
    underMoreDetails: true,
  },
  design_motifs: {
    key: "design_motifs",
    label: "Design motifs",
    inputId: "design-motifs",
    optional: true,
    underMoreDetails: true,
  },
  condition_notes: {
    key: "condition_notes",
    label: "Condition notes",
    inputId: "condition-notes",
    optional: true,
    underMoreDetails: true,
  },
};

function toReadableStatus(status: AppraisalStatus): string {
  if (status === "reviewed") return "Reviewed";
  if (status === "finalized") return "Finalized";
  if (status === "void") return "Void";
  return "Draft";
}

function conditionUiToApi(value: string): string {
  if (value === "poor") return "distressed";
  if (value === "unknown") return "";
  return value;
}

function conditionApiToUi(value: string): string {
  if (value === "distressed") return "poor";
  if (value === "very_good") return "good";
  if (!value) return "unknown";
  return value;
}

function formatDraftListDate(value: string | null): string {
  if (!value) return "No date";
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return value;
  return parsed.toLocaleDateString();
}

function parseStoredResult(row: AppraisalDraftListItem): AppraisalUiResult | null {
  const custom = row.custom_fields;
  if (!custom || typeof custom !== "object") return null;
  const raw = (custom as Record<string, unknown>).ai_structured_output;
  if (!raw || typeof raw !== "object") return null;
  const payload = raw as Record<string, unknown>;
  if (typeof payload.assistant_message !== "string" || typeof payload.mode !== "string") {
    return null;
  }

  const qualityRaw = (custom as Record<string, unknown>).quality_metrics;
  const quality =
    qualityRaw && typeof qualityRaw === "object"
      ? (qualityRaw as AppraisalGenerateResponse["quality"])
      : {
          completeness_score: 0,
          missing_required_fields: [],
          missing_recommended_fields: [],
          evidence_fields_used: [],
        };

  return {
    ...(payload as AppraisalGenerateResponse),
    appraisal_id: row.id,
    persisted: true,
    source_type:
      (custom as Record<string, unknown>).source_type === "inventory_linked"
        ? "inventory_linked"
        : "customer_owned",
    quality,
  };
}

function buildClientPreview(result: AppraisalUiResult): string {
  if (result.mode === "cannot_generate" || !result.draft) {
    return result.assistant_message;
  }
  const header = result.draft.header;
  const valueSection = result.draft.value_section;
  const lines = [
    `Customer: ${header.customer_name ?? "-"}`,
    `Contact: ${header.customer_contact ?? "-"}`,
    `Date: ${header.appraisal_date ?? "-"}`,
    `Rug: ${header.rug_label ?? "-"}`,
    `Size: ${header.rug_size_text ?? "-"}`,
    "",
    ...result.draft.description_paragraphs,
    "",
    `${valueSection.label}: ${typeof valueSection.amount === "number" ? `${valueSection.amount} ${valueSection.currency ?? ""}`.trim() : "-"}`,
    valueSection.statement,
    "",
    ...result.draft.disclaimers,
  ];
  return lines.join("\n").trim();
}

export function AppraisalScreen({ tenantId }: AppraisalScreenProps) {
  const [form, setForm] = useState<AppraisalFormState>(DEFAULT_FORM);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [result, setResult] = useState<AppraisalUiResult | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [rugQuery, setRugQuery] = useState("");
  const [rugLoading, setRugLoading] = useState(false);
  const [rugRows, setRugRows] = useState<AppraisalRugSearchRow[]>([]);
  const [draftsLoading, setDraftsLoading] = useState(false);
  const [draftRows, setDraftRows] = useState<AppraisalDraftListItem[]>([]);
  const [moreDetailsOpen, setMoreDetailsOpen] = useState(false);

  const isFinalized = form.status === "finalized" && Boolean(form.appraisal_id);

  const previewText = useMemo(() => (result ? buildClientPreview(result) : ""), [result]);
  const rawJsonText = useMemo(() => (result ? JSON.stringify(result, null, 2) : ""), [result]);

  const missingFieldItems = useMemo(() => {
    if (!result) return [];
    const rows = [
      ...result.quality.missing_required_fields.map((key) => ({ key, optional: false })),
      ...result.quality.missing_recommended_fields.map((key) => ({ key, optional: true })),
    ];

    const deduped: MissingFieldItem[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      const mapped = MISSING_FIELD_MAP[row.key];
      if (!mapped || seen.has(mapped.key)) continue;
      seen.add(mapped.key);
      deduped.push({ ...mapped, optional: row.optional });
    }
    return deduped;
  }, [result]);

  const onField =
    (field: keyof AppraisalFormState) =>
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      if (isFinalized) return;
      setForm((prev) => ({
        ...prev,
        [field]: event.target.value,
      }));
      setHasUnsavedChanges(true);
    };

  const loadDrafts = async () => {
    setDraftsLoading(true);
    try {
      const payload = await listAppraisalDraftsClient({
        tenantId,
        limit: 25,
      });
      setDraftRows(payload.rows);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Could not load saved appraisals."
      );
    } finally {
      setDraftsLoading(false);
    }
  };

  useEffect(() => {
    void loadDrafts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  const onSearchRugs = async () => {
    if (form.source_type !== "inventory_linked") return;
    setRugLoading(true);
    setError(null);
    try {
      const payload = await listAppraisalRugsClient({
        tenantId,
        q: rugQuery.trim(),
        status: "available",
        limit: 20,
      });
      setRugRows(payload.rows);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Could not load store rugs."
      );
    } finally {
      setRugLoading(false);
    }
  };

  const onPickRug = (rugId: string) => {
    if (isFinalized) return;
    const selected = rugRows.find((item) => item.id === rugId);
    if (!selected) {
      setError("Could not load selected rug details.");
      return;
    }
    setError(null);
    setForm((prev) => {
      const next = applyRugToForm(prev, selected);
      next.appraisal_date = prev.appraisal_date || todayDate();
      next.condition = conditionApiToUi(next.condition);
      return next;
    });
    setHasUnsavedChanges(true);
    setNotice(`Loaded rug ${selected.intake_label}.`);
  };

  const onToggleSource = (sourceType: AppraisalFormState["source_type"]) => {
    if (isFinalized) return;
    setForm((prev) => ({
      ...prev,
      source_type: sourceType,
      rug_id: sourceType === "inventory_linked" ? prev.rug_id : "",
    }));
    setHasUnsavedChanges(true);
  };

  const onGenerate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isFinalized) return;

    setError(null);
    setNotice(null);
    setIsLoading(true);

    try {
      const payload = await generateAppraisalDraftClient(
        toAppraisalInput({
          ...form,
          condition: conditionUiToApi(form.condition),
          status: "draft",
        }),
        {
          tenantId,
          sourceType: form.source_type,
          rugId: form.rug_id || null,
          appraisalId: form.appraisal_id || null,
          persist: true,
        }
      );

      setResult(payload);
      if (payload.appraisal_id) {
        setForm((prev) => ({
          ...prev,
          appraisal_id: payload.appraisal_id ?? prev.appraisal_id,
          status: "draft",
        }));
      }
      setHasUnsavedChanges(false);
      setNotice("Draft generated and saved.");
      void loadDrafts();
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "We couldn't generate the draft right now."
      );
    } finally {
      setIsLoading(false);
    }
  };

  const onSaveStatus = async (status: AppraisalStatus) => {
    if (isFinalized || !result) {
      if (!result) setError("Generate a draft before saving.");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const payload = await saveAppraisalDraftClient({
        tenantId,
        sourceType: form.source_type,
        appraisalId: form.appraisal_id || result.appraisal_id || null,
        rugId: form.rug_id || null,
        status,
        appraisalContext: toAppraisalInput({
          ...form,
          condition: conditionUiToApi(form.condition),
          status,
        }),
        draftPayload: result,
        draftText: previewText,
      });

      if (payload.appraisal_id) {
        setForm((prev) => ({
          ...prev,
          appraisal_id: payload.appraisal_id ?? prev.appraisal_id,
          status,
        }));
      } else {
        setForm((prev) => ({ ...prev, status }));
      }

      setHasUnsavedChanges(false);
      setNotice(`Saved as ${toReadableStatus(status)}.`);
      void loadDrafts();
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Unable to save this draft."
      );
    } finally {
      setIsLoading(false);
    }
  };

  const onLoadDraft = (draft: AppraisalDraftListItem) => {
    const nextForm = applyDraftToForm(DEFAULT_FORM, draft);
    nextForm.appraisal_date = nextForm.appraisal_date || todayDate();
    nextForm.condition = conditionApiToUi(nextForm.condition);
    setForm(nextForm);
    setResult(parseStoredResult(draft));
    setError(null);
    setNotice(`Loaded ${draft.customer_name ?? draft.external_rug_label ?? "saved appraisal"}.`);
    setHasUnsavedChanges(false);
  };

  const onNewAppraisal = () => {
    if (hasUnsavedChanges) {
      const confirmed = window.confirm("Discard unsaved changes and start a new draft?");
      if (!confirmed) return;
    }

    setForm({ ...DEFAULT_FORM, appraisal_date: todayDate() });
    setResult(null);
    setError(null);
    setNotice(null);
    setRugRows([]);
    setRugQuery("");
    setHasUnsavedChanges(false);
  };

  const onCreateDraftCopy = () => {
    setForm((prev) => ({
      ...prev,
      appraisal_id: "",
      status: "draft",
    }));
    setHasUnsavedChanges(true);
    setNotice("You can now edit this as a new draft copy.");
  };

  const onMissingFieldClick = (item: MissingFieldItem) => {
    if (item.underMoreDetails) {
      setMoreDetailsOpen(true);
    }
    window.setTimeout(() => {
      const node = document.getElementById(item.inputId);
      node?.focus();
      node?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 80);
  };

  const onCopy = async (value: string, label: string) => {
    try {
      await copyTextToClipboard(value);
      setNotice(label);
      window.setTimeout(() => setNotice(null), 1800);
    } catch {
      setError("Clipboard access failed. Copy directly from the preview instead.");
    }
  };

  const onExport = (filename: string, content: string, label: string) => {
    downloadTextFile(filename, content);
    setNotice(label);
    window.setTimeout(() => setNotice(null), 1800);
  };

  return (
    <AppShell variant="workflow">
      <PageHeader
        kicker="Staff Workflow"
        title="Appraisal Studio"
        subtitle="Build clean, client-ready appraisal drafts from store rugs or customer rugs."
        variant="workflow"
        actions={
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">Role: Staff</Badge>
            <Badge variant="outline" className="hidden max-w-[18rem] truncate sm:inline-flex">
              Tenant: {tenantId}
            </Badge>
            <Badge variant={isFinalized ? "warning" : "outline"}>
              Status: {toReadableStatus(form.status)}
            </Badge>
          </div>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.12fr)_minmax(340px,0.88fr)]">
        <section className="space-y-4">
          {isFinalized ? (
            <Alert>
              <AlertTitle>Finalized</AlertTitle>
              <AlertDescription>
                This appraisal is locked. Use Create New Draft Copy to make changes in a new draft.
              </AlertDescription>
            </Alert>
          ) : null}

          {missingFieldItems.length > 0 ? (
            <Alert>
              <AlertTitle>Missing info to improve this draft</AlertTitle>
              <AlertDescription>
                <ul className="mt-2 grid gap-1">
                  {missingFieldItems.slice(0, 6).map((item) => (
                    <li key={item.key}>
                      <button
                        type="button"
                        className="text-left text-sm underline underline-offset-2"
                        onClick={() => onMissingFieldClick(item)}
                      >
                        {item.label}
                        {item.optional ? " (optional)" : ""}
                      </button>
                    </li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          ) : null}

          <form onSubmit={onGenerate} className="space-y-4">
            <SectionCard
              title="Step A · Choose Source"
              description="Tell us where this rug record is coming from."
              tone="soft"
              className="border-border/55"
            >
              <div className="grid gap-2 sm:grid-cols-2">
                <Button
                  type="button"
                  variant={form.source_type === "inventory_linked" ? "default" : "outline"}
                  className="h-11"
                  onClick={() => onToggleSource("inventory_linked")}
                  disabled={isLoading || isFinalized}
                >
                  Use Store Rug
                </Button>
                <Button
                  type="button"
                  variant={form.source_type === "customer_owned" ? "default" : "outline"}
                  className="h-11"
                  onClick={() => onToggleSource("customer_owned")}
                  disabled={isLoading || isFinalized}
                >
                  Customer Rug
                </Button>
              </div>

              {form.source_type === "inventory_linked" ? (
                <div className="mt-4 space-y-3">
                  <div className="flex flex-wrap gap-2">
                    <Input
                      value={rugQuery}
                      onChange={(event) => setRugQuery(event.target.value)}
                      placeholder="Search by label, style, palette, or SKU"
                      disabled={isLoading || isFinalized}
                    />
                    <Button type="button" variant="secondary" onClick={() => void onSearchRugs()} disabled={rugLoading || isFinalized}>
                      {rugLoading ? "Searching..." : "Find Rugs"}
                    </Button>
                  </div>

                  {form.rug_id ? (
                    <p className="text-sm text-muted-foreground">
                      Selected rug: <span className="font-medium text-foreground">{form.external_rug_label || form.rug_type_label || form.rug_id}</span>
                    </p>
                  ) : null}

                  <div className="max-h-44 space-y-2 overflow-y-auto pr-1">
                    {rugRows.map((rug) => (
                      <button
                        key={rug.id}
                        type="button"
                        onClick={() => onPickRug(rug.id)}
                        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-left hover:bg-accent"
                        disabled={isFinalized}
                      >
                        <p className="text-sm font-medium">{rug.intake_label}</p>
                        <p className="text-xs text-muted-foreground">
                          {rug.style ?? "-"} • {rug.palette ?? "-"}
                        </p>
                      </button>
                    ))}
                    {rugRows.length === 0 && rugQuery ? (
                      <p className="text-sm text-muted-foreground">No store rugs found yet.</p>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div className="mt-4 space-y-2">
                  <Label htmlFor="customer-rug-label">Customer rug label (optional)</Label>
                  <Input
                    id="customer-rug-label"
                    value={form.external_rug_label}
                    onChange={onField("external_rug_label")}
                    placeholder="Example: Family Heriz rug"
                    disabled={isFinalized}
                  />
                </div>
              )}
            </SectionCard>

            <SectionCard
              title="Step B · Essentials"
              description="Keep this simple. Start with these 4 fields."
              tone="soft"
              className="border-border/55"
            >
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="essential-appraised-value">Appraised Value (USD)</Label>
                  <Input
                    id="essential-appraised-value"
                    type="number"
                    min="0"
                    step="1"
                    value={form.appraised_value}
                    onChange={onField("appraised_value")}
                    disabled={isFinalized}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="essential-condition">Condition</Label>
                  <select
                    id="essential-condition"
                    value={conditionApiToUi(form.condition)}
                    onChange={(event) => {
                      const uiValue = event.target.value;
                      setForm((prev) => ({
                        ...prev,
                        condition: conditionUiToApi(uiValue),
                      }));
                      setHasUnsavedChanges(true);
                    }}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    disabled={isFinalized}
                  >
                    <option value="excellent">Excellent</option>
                    <option value="good">Good</option>
                    <option value="fair">Fair</option>
                    <option value="poor">Poor</option>
                    <option value="unknown">Unknown</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="essential-appraisal-date">Appraisal Date</Label>
                  <Input
                    id="essential-appraisal-date"
                    type="date"
                    value={form.appraisal_date}
                    onChange={onField("appraisal_date")}
                    disabled={isFinalized}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="essential-customer-name">Customer Name (optional)</Label>
                  <Input
                    id="essential-customer-name"
                    value={form.customer_name}
                    onChange={onField("customer_name")}
                    placeholder="Customer name"
                    disabled={isFinalized}
                  />
                </div>
              </div>
            </SectionCard>

            <SectionCard title="Step C · Actions" tone="soft" className="border-border/55">
              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={isLoading || isFinalized}>
                  {isLoading ? "Generating..." : "Generate Draft"}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={isLoading || !result || isFinalized || !hasUnsavedChanges}
                  onClick={() => void onSaveStatus("draft")}
                >
                  Save Draft
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={isLoading || !result || !form.appraisal_id || isFinalized}
                  onClick={() => void onSaveStatus("finalized")}
                >
                  Mark Final
                </Button>
                <Button type="button" variant="ghost" onClick={onNewAppraisal} disabled={isLoading}>
                  New Appraisal
                </Button>
                {isFinalized ? (
                  <Button type="button" variant="outline" onClick={onCreateDraftCopy}>
                    Create New Draft Copy
                  </Button>
                ) : null}
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                Finalized drafts are locked and cannot be edited.
              </p>
            </SectionCard>
          </form>

          <SectionCard tone="transparent" density="compact">
            <Accordion
              type="single"
              collapsible
              value={moreDetailsOpen ? "more-details" : undefined}
              onValueChange={(value) => setMoreDetailsOpen(value === "more-details")}
            >
              <AccordionItem value="more-details" className="border-0">
                <AccordionTrigger className="py-0 text-base font-semibold hover:no-underline">
                  More details (optional)
                </AccordionTrigger>
                <AccordionContent className="pt-4">
                  <div className="grid gap-4">
                    <SectionCard
                      title="Customer details"
                      contentClassName="space-y-3"
                      tone="transparent"
                      density="compact"
                    >
                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="space-y-2">
                          <Label htmlFor="customer-phone">Phone</Label>
                          <Input id="customer-phone" value={form.customer_phone} onChange={onField("customer_phone")} disabled={isFinalized} />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="customer-email">Email</Label>
                          <Input id="customer-email" value={form.customer_email} onChange={onField("customer_email")} disabled={isFinalized} />
                        </div>
                        <div className="space-y-2 md:col-span-2">
                          <Label htmlFor="customer-address1">Address Line 1</Label>
                          <Input id="customer-address1" value={form.customer_address_line1} onChange={onField("customer_address_line1")} disabled={isFinalized} />
                        </div>
                        <div className="space-y-2 md:col-span-2">
                          <Label htmlFor="customer-address2">Address Line 2</Label>
                          <Input id="customer-address2" value={form.customer_address_line2} onChange={onField("customer_address_line2")} disabled={isFinalized} />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="customer-city">City</Label>
                          <Input id="customer-city" value={form.customer_city} onChange={onField("customer_city")} disabled={isFinalized} />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="customer-state">State</Label>
                          <Input id="customer-state" value={form.customer_state} onChange={onField("customer_state")} disabled={isFinalized} />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="customer-postal">Postal Code</Label>
                          <Input id="customer-postal" value={form.customer_postal_code} onChange={onField("customer_postal_code")} disabled={isFinalized} />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="customer-country">Country</Label>
                          <Input id="customer-country" value={form.customer_country} onChange={onField("customer_country")} disabled={isFinalized} />
                        </div>
                      </div>
                    </SectionCard>

                    <SectionCard
                      title="Rug details and overrides"
                      contentClassName="space-y-3"
                      tone="transparent"
                      density="compact"
                    >
                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="space-y-2">
                          <Label htmlFor="rug-type-label">Rug label/type</Label>
                          <Input id="rug-type-label" value={form.rug_type_label} onChange={onField("rug_type_label")} disabled={isFinalized} />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="origin-country">Origin country</Label>
                          <Input id="origin-country" value={form.origin_country} onChange={onField("origin_country")} disabled={isFinalized} />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="construction">Construction</Label>
                          <Input id="construction" value={form.construction} onChange={onField("construction")} disabled={isFinalized} />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="pile-material">Pile material</Label>
                          <Input id="pile-material" value={form.pile_material} onChange={onField("pile_material")} disabled={isFinalized} />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="foundation">Foundation</Label>
                          <Input id="foundation" value={form.foundation} onChange={onField("foundation")} disabled={isFinalized} />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="region">Region</Label>
                          <Input id="region" value={form.region} onChange={onField("region")} disabled={isFinalized} />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="age-category">Age category</Label>
                          <Input id="age-category" value={form.age_category} onChange={onField("age_category")} disabled={isFinalized} />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="rug-size-text">Size text</Label>
                          <Input id="rug-size-text" value={form.rug_size_text} onChange={onField("rug_size_text")} disabled={isFinalized} />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="dominant-colors">Dominant colors</Label>
                          <Input id="dominant-colors" value={form.dominant_colors} onChange={onField("dominant_colors")} placeholder="comma separated" disabled={isFinalized} />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="design-motifs">Design motifs</Label>
                          <Input id="design-motifs" value={form.design_motifs} onChange={onField("design_motifs")} placeholder="comma separated" disabled={isFinalized} />
                        </div>
                        <div className="space-y-2 md:col-span-2">
                          <Label htmlFor="condition-notes">Condition notes</Label>
                          <Textarea id="condition-notes" value={form.condition_notes} onChange={onField("condition_notes")} disabled={isFinalized} />
                        </div>
                      </div>
                    </SectionCard>

                    <SectionCard
                      title="Staff notes"
                      contentClassName="space-y-3"
                      tone="transparent"
                      density="compact"
                    >
                      <Textarea
                        id="staff-notes"
                        value={form.staff_notes}
                        onChange={onField("staff_notes")}
                        placeholder="Internal notes for team review"
                        disabled={isFinalized}
                      />
                    </SectionCard>

                    <SectionCard tone="transparent" density="compact">
                      <Accordion type="single" collapsible>
                        <AccordionItem value="advanced" className="border-0">
                          <AccordionTrigger className="py-0 text-sm font-semibold hover:no-underline">
                            Advanced tools
                          </AccordionTrigger>
                          <AccordionContent className="pt-4">
                            <div className="flex flex-wrap gap-2">
                              <Button type="button" variant="secondary" disabled={!result} onClick={() => void onCopy(previewText, "Copied draft text.")}>Copy Draft Text</Button>
                              <Button type="button" variant="secondary" disabled={!result} onClick={() => void onCopy(rawJsonText, "Copied draft JSON.")}>Copy JSON</Button>
                              <Button type="button" variant="outline" disabled={!result} onClick={() => onExport("appraisal-draft.txt", previewText, "Exported TXT.")}>Export TXT</Button>
                              <Button type="button" variant="outline" disabled={!result} onClick={() => onExport("appraisal-draft.json", rawJsonText, "Exported JSON.")}>Export JSON</Button>
                            </div>
                            {result ? (
                              <pre className="mt-3 overflow-auto rounded-lg border border-border bg-muted/40 p-3 text-xs">
                                {JSON.stringify(
                                  {
                                    completeness_score: result.quality.completeness_score,
                                    evidence_fields_used: result.quality.evidence_fields_used,
                                    missing_required_fields: result.quality.missing_required_fields,
                                    missing_recommended_fields: result.quality.missing_recommended_fields,
                                  },
                                  null,
                                  2
                                )}
                              </pre>
                            ) : null}
                          </AccordionContent>
                        </AccordionItem>
                      </Accordion>
                    </SectionCard>
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </SectionCard>
        </section>

        <section className="space-y-4">
          <SectionCard
            title="Preview"
            description="Client-facing draft format."
            tone="soft"
            className="border-border/55"
          >
            {!result ? (
              <div className="rounded-lg border border-dashed border-border bg-background/70 p-5 text-sm text-muted-foreground">
                Generate a draft to view the document preview.
              </div>
            ) : (
              <Tabs defaultValue="client">
                <TabsList>
                  <TabsTrigger value="client">Client Draft</TabsTrigger>
                  <TabsTrigger value="internal">Internal</TabsTrigger>
                </TabsList>

                <TabsContent value="client" className="mt-3">
                  <div className="doc-preview">
                    {result.mode === "cannot_generate" || !result.draft ? (
                      <p>{result.notes ?? result.assistant_message}</p>
                    ) : (
                      <>
                        <h2>Appraisal Draft</h2>
                        <p><strong>Customer:</strong> {result.draft.header.customer_name ?? "-"}</p>
                        <p><strong>Contact:</strong> {result.draft.header.customer_contact ?? "-"}</p>
                        <p><strong>Date:</strong> {result.draft.header.appraisal_date ?? "-"}</p>
                        <p><strong>Rug:</strong> {result.draft.header.rug_label ?? "-"}</p>
                        <p><strong>Size:</strong> {result.draft.header.rug_size_text ?? "-"}</p>

                        <h3>Description</h3>
                        {result.draft.description_paragraphs.map((line) => (
                          <p key={line}>{line}</p>
                        ))}

                        <h3>Value Statement</h3>
                        <p>
                          <strong>{result.draft.value_section.label}:</strong>{" "}
                          {typeof result.draft.value_section.amount === "number"
                            ? `${result.draft.value_section.amount} ${result.draft.value_section.currency ?? ""}`.trim()
                            : "-"}
                        </p>
                        <p>{result.draft.value_section.statement}</p>

                        <h3>Disclaimers</h3>
                        <ul>
                          {result.draft.disclaimers.map((line) => (
                            <li key={line}>{line}</li>
                          ))}
                        </ul>
                      </>
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="internal" className="mt-3 space-y-3">
                  <SectionCard
                    title="Generation Notes"
                    contentClassName="space-y-2"
                    tone="transparent"
                    density="compact"
                  >
                    <p className="text-sm">{result.assistant_message}</p>
                    {result.notes ? <p className="text-sm text-muted-foreground">{result.notes}</p> : null}
                  </SectionCard>

                  <SectionCard
                    title="Missing Fields"
                    contentClassName="space-y-2"
                    tone="transparent"
                    density="compact"
                  >
                    <p className="text-sm"><strong>Required:</strong> {result.quality.missing_required_fields.join(", ") || "None"}</p>
                    <p className="text-sm"><strong>Recommended:</strong> {result.quality.missing_recommended_fields.join(", ") || "None"}</p>
                    <p className="text-sm"><strong>Evidence used:</strong> {result.quality.evidence_fields_used.join(", ") || "None"}</p>
                  </SectionCard>
                </TabsContent>
              </Tabs>
            )}
          </SectionCard>

          <SectionCard
            title="Recent Drafts"
            description={draftsLoading ? "Loading..." : `${draftRows.length} drafts`}
            tone="soft"
            className="border-border/55"
          >
            {draftRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No drafts yet.</p>
            ) : (
              <div className="space-y-2">
                {draftRows.map((draft) => (
                  <button
                    key={draft.id}
                    type="button"
                    className="w-full rounded-xl border border-border bg-background px-3 py-3 text-left hover:bg-accent"
                    onClick={() => onLoadDraft(draft)}
                  >
                    <p className="text-sm font-medium">
                      {draft.customer_name ?? draft.external_rug_label ?? "Untitled appraisal"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {toReadableStatus(draft.status)} • {formatDraftListDate(draft.appraisal_date)}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </SectionCard>
        </section>
      </div>

      {notice ? (
        <div className="mt-4">
          <Alert>
            <AlertTitle>Update</AlertTitle>
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        </div>
      ) : null}

      {error ? (
        <div className="mt-4">
          <Alert variant="destructive">
            <AlertTitle>Something went wrong</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        </div>
      ) : null}
    </AppShell>
  );
}
