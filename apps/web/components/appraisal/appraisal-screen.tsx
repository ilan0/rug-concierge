"use client";

import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import {
  appraisalToPlainText,
  copyTextToClipboard,
  downloadTextFile,
  generateAppraisalDraftClient,
  listAppraisalDraftsClient,
  listAppraisalRugsClient,
  saveAppraisalDraftClient,
} from "@/lib/appraisal/client";
import type {
  AppraisalDraftListItem,
  AppraisalRugSearchRow,
  AppraisalStatus,
} from "@/lib/types/appraisal";
import type { AppraisalUiResult, AppraisalFormState } from "@/lib/types/appraisal-ui";
import { applyDraftToForm, applyRugToForm, toAppraisalInput } from "@/lib/types/appraisal-ui";

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
  appraisal_date: "",
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

function formatGeneratedAt(value: string | null): string {
  if (!value) return "Not generated yet";
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return "Not generated yet";
  return parsed.toLocaleString();
}

function normalizeDraftStatus(value: string): AppraisalStatus {
  if (value === "reviewed" || value === "finalized" || value === "void") return value;
  return "draft";
}

export function AppraisalScreen({ tenantId }: AppraisalScreenProps) {
  const [form, setForm] = useState<AppraisalFormState>(DEFAULT_FORM);
  const [isLoading, setIsLoading] = useState(false);
  const [showSlowNotice, setShowSlowNotice] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AppraisalUiResult | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [lastGeneratedAt, setLastGeneratedAt] = useState<string | null>(null);
  const [persistOnGenerate, setPersistOnGenerate] = useState(true);

  const [rugQuery, setRugQuery] = useState("");
  const [rugLoading, setRugLoading] = useState(false);
  const [rugRows, setRugRows] = useState<AppraisalRugSearchRow[]>([]);

  const [draftsLoading, setDraftsLoading] = useState(false);
  const [draftRows, setDraftRows] = useState<AppraisalDraftListItem[]>([]);

  const plainText = useMemo(() => (result ? appraisalToPlainText(result) : ""), [result]);
  const jsonText = useMemo(() => (result ? JSON.stringify(result, null, 2) : ""), [result]);

  const onField =
    (field: keyof AppraisalFormState) =>
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      setForm((prev) => ({
        ...prev,
        [field]: event.target.value,
      }));
    };

  useEffect(() => {
    if (!isLoading) {
      setShowSlowNotice(false);
      return undefined;
    }
    const timer = window.setTimeout(() => setShowSlowNotice(true), 8000);
    return () => window.clearTimeout(timer);
  }, [isLoading]);

  const loadDrafts = async () => {
    setDraftsLoading(true);
    try {
      const payload = await listAppraisalDraftsClient({
        tenantId,
        limit: 20,
      });
      setDraftRows(payload.rows);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Unable to load saved appraisal drafts."
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
          : "Unable to load inventory rugs."
      );
    } finally {
      setRugLoading(false);
    }
  };

  const onPickRug = async (rugId: string) => {
    const selected = rugRows.find((item) => item.id === rugId);
    if (!selected) {
      setError("Could not load selected rug details.");
      return;
    }
    setError(null);
    setForm((prev) => applyRugToForm(prev, selected));
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setFeedback(null);
    setIsLoading(true);

    try {
      const payload = await generateAppraisalDraftClient(toAppraisalInput(form), {
        tenantId,
        sourceType: form.source_type,
        rugId: form.rug_id || null,
        appraisalId: form.appraisal_id || null,
        persist: persistOnGenerate,
      });
      setResult(payload);
      setLastGeneratedAt(new Date().toISOString());
      if (payload.appraisal_id) {
        setForm((prev) => ({ ...prev, appraisal_id: payload.appraisal_id ?? prev.appraisal_id }));
      }
      setFeedback(payload.persisted ? "Draft generated and saved." : "Draft generated.");
      void loadDrafts();
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "We couldn't generate the draft right now. Please review inputs and try again."
      );
    } finally {
      setIsLoading(false);
    }
  };

  const onSaveStatus = async (status: AppraisalStatus) => {
    if (!result) {
      setError("Generate a draft before saving.");
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
          status,
        }),
        draftPayload: result,
        draftText: plainText,
      });
      if (payload.appraisal_id) {
        setForm((prev) => ({
          ...prev,
          appraisal_id: payload.appraisal_id ?? prev.appraisal_id,
          status,
        }));
      }
      setFeedback(`Draft saved as ${status}.`);
      void loadDrafts();
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : "Unable to save appraisal draft."
      );
    } finally {
      setIsLoading(false);
    }
  };

  const onLoadDraft = (draft: AppraisalDraftListItem) => {
    setForm((prev) => applyDraftToForm(prev, draft));
    setFeedback(`Loaded draft ${draft.id.slice(0, 8)}...`);
  };

  const onReset = () => {
    setForm(DEFAULT_FORM);
    setResult(null);
    setError(null);
    setFeedback(null);
    setLastGeneratedAt(null);
    setRugRows([]);
    setRugQuery("");
  };

  const copy = async (label: "text" | "json", value: string) => {
    try {
      await copyTextToClipboard(value);
      setFeedback(label === "text" ? "Copied draft text." : "Copied raw JSON.");
      setTimeout(() => setFeedback((prev) => (prev ? null : prev)), 1400);
    } catch {
      setError("Clipboard access failed. Please copy directly from the preview text.");
    }
  };

  const exportFile = (filename: string, content: string, label: string) => {
    downloadTextFile(filename, content);
    setFeedback(label);
    setTimeout(() => setFeedback((prev) => (prev ? null : prev)), 1400);
  };

  const missingCount = result?.missing_fields.length ?? 0;

  return (
    <main className="ui-shell ui-showroom appraisal-page appraisal-showroom">
      <header className="ui-header appraisal-header">
        <div>
          <p className="ui-kicker appraisal-eyebrow">Monetizable Service</p>
          <h1>Appraisal Draft Studio</h1>
          <p className="ui-subtitle">
            Staff-only appraisal drafting with inventory-linked and customer-owned workflows.
          </p>
        </div>
        <div className="appraisal-role-chip">Role locked: store_staff / developer</div>
      </header>

      <section className="appraisal-summary-chips" aria-label="Appraisal summary">
        <span className="appraisal-chip">
          <strong>Tenant:</strong> {tenantId}
        </span>
        <span className="appraisal-chip">
          <strong>Status:</strong> {result?.mode ?? "idle"}
        </span>
        <span className="appraisal-chip">
          <strong>Missing fields:</strong> {missingCount}
        </span>
        <span className="appraisal-chip">
          <strong>Last generated:</strong> {formatGeneratedAt(lastGeneratedAt)}
        </span>
      </section>

      <div className="appraisal-layout">
        <section className="appraisal-form-panel">
          <div className="appraisal-panel-head">
            <h2>Appraisal Input</h2>
            <p>Use inventory-linked source for store rugs, or customer-owned source for external rugs.</p>
          </div>

          <form onSubmit={onSubmit} className="appraisal-form">
            <fieldset className="appraisal-form-group">
              <legend>Workflow</legend>
              <label>
                Source Type
                <select value={form.source_type} onChange={onField("source_type")}>
                  <option value="customer_owned">customer_owned</option>
                  <option value="inventory_linked">inventory_linked</option>
                </select>
              </label>
              <label>
                Status
                <select value={form.status} onChange={onField("status")}>
                  <option value="draft">draft</option>
                  <option value="reviewed">reviewed</option>
                  <option value="finalized">finalized</option>
                  <option value="void">void</option>
                </select>
              </label>
              <label>
                Appraisal Date
                <input
                  value={form.appraisal_date}
                  onChange={onField("appraisal_date")}
                  placeholder="YYYY-MM-DD"
                />
              </label>
              <label>
                Persist on Generate
                <select
                  value={persistOnGenerate ? "yes" : "no"}
                  onChange={(event) => setPersistOnGenerate(event.target.value === "yes")}
                >
                  <option value="yes">yes</option>
                  <option value="no">no</option>
                </select>
              </label>
            </fieldset>

            {form.source_type === "inventory_linked" ? (
              <fieldset className="appraisal-form-group">
                <legend>Inventory Rug Link</legend>
                <label className="appraisal-form-full">
                  Search
                  <input value={rugQuery} onChange={(event) => setRugQuery(event.target.value)} placeholder="SKU, intake label, style, palette" />
                </label>
                <div className="appraisal-actions">
                  <button type="button" onClick={() => void onSearchRugs()} disabled={rugLoading}>
                    {rugLoading ? "Searching..." : "Search Rugs"}
                  </button>
                </div>
                <div className="appraisal-draft-list">
                  {rugRows.map((rug) => (
                    <button
                      className="appraisal-draft-row"
                      type="button"
                      key={rug.id}
                      onClick={() => void onPickRug(rug.id)}
                    >
                      <strong>{rug.intake_label}</strong>
                      <span>{rug.style ?? "-"}</span>
                      <span>{rug.palette ?? "-"}</span>
                    </button>
                  ))}
                </div>
              </fieldset>
            ) : null}

            <fieldset className="appraisal-form-group">
              <legend>Customer</legend>
              <label>
                Customer Name
                <input value={form.customer_name} onChange={onField("customer_name")} />
              </label>
              <label>
                Phone
                <input value={form.customer_phone} onChange={onField("customer_phone")} />
              </label>
              <label>
                Email
                <input value={form.customer_email} onChange={onField("customer_email")} />
              </label>
              <label>
                Address 1
                <input value={form.customer_address_line1} onChange={onField("customer_address_line1")} />
              </label>
              <label>
                City
                <input value={form.customer_city} onChange={onField("customer_city")} />
              </label>
              <label>
                State
                <input value={form.customer_state} onChange={onField("customer_state")} />
              </label>
              <label>
                Postal
                <input value={form.customer_postal_code} onChange={onField("customer_postal_code")} />
              </label>
              <label>
                Country
                <input value={form.customer_country} onChange={onField("customer_country")} />
              </label>
            </fieldset>

            <fieldset className="appraisal-form-group">
              <legend>Rug Details</legend>
              <label>
                Rug Type Label
                <input value={form.rug_type_label} onChange={onField("rug_type_label")} />
              </label>
              <label>
                External Rug Label
                <input value={form.external_rug_label} onChange={onField("external_rug_label")} />
              </label>
              <label>
                Condition
                <select value={form.condition} onChange={onField("condition")}>
                  <option value="">(unspecified)</option>
                  <option value="excellent">excellent</option>
                  <option value="very_good">very_good</option>
                  <option value="good">good</option>
                  <option value="fair">fair</option>
                  <option value="distressed">distressed</option>
                </select>
              </label>
              <label>
                Condition Notes
                <input value={form.condition_notes} onChange={onField("condition_notes")} />
              </label>
              <label>
                Origin Country
                <input value={form.origin_country} onChange={onField("origin_country")} />
              </label>
              <label>
                Region
                <input value={form.region} onChange={onField("region")} />
              </label>
              <label>
                Age Category
                <input value={form.age_category} onChange={onField("age_category")} />
              </label>
              <label>
                Construction
                <input value={form.construction} onChange={onField("construction")} />
              </label>
              <label>
                Foundation
                <input value={form.foundation} onChange={onField("foundation")} />
              </label>
              <label>
                Pile Material
                <input value={form.pile_material} onChange={onField("pile_material")} />
              </label>
              <label>
                Width ft
                <input type="number" value={form.width_ft} onChange={onField("width_ft")} />
              </label>
              <label>
                Width in (0-11)
                <input type="number" value={form.width_in} onChange={onField("width_in")} />
              </label>
              <label>
                Length ft
                <input type="number" value={form.length_ft} onChange={onField("length_ft")} />
              </label>
              <label>
                Length in (0-11)
                <input type="number" value={form.length_in} onChange={onField("length_in")} />
              </label>
              <label>
                Rug Size Text
                <input value={form.rug_size_text} onChange={onField("rug_size_text")} />
              </label>
              <label>
                Dominant Colors (comma)
                <input value={form.dominant_colors} onChange={onField("dominant_colors")} />
              </label>
              <label>
                Design Motifs (comma)
                <input value={form.design_motifs} onChange={onField("design_motifs")} />
              </label>
            </fieldset>

            <fieldset className="appraisal-form-group">
              <legend>Value + Notes</legend>
              <label>
                Appraised Value
                <input type="number" min="0" step="1" value={form.appraised_value} onChange={onField("appraised_value")} />
              </label>
              <label>
                Style (legacy prompt helper)
                <input value={form.style} onChange={onField("style")} />
              </label>
              <label>
                Palette (legacy prompt helper)
                <input value={form.palette} onChange={onField("palette")} />
              </label>
              <label className="appraisal-form-full">
                Staff Notes
                <textarea value={form.staff_notes} onChange={onField("staff_notes")} />
              </label>
            </fieldset>

            <div className="appraisal-actions">
              <button className="appraisal-primary-btn" type="submit" disabled={isLoading}>
                {isLoading ? "Generating..." : "Generate Draft"}
              </button>
              <button type="button" onClick={() => void onSaveStatus(normalizeDraftStatus(form.status))} disabled={isLoading || !result}>
                Save Draft
              </button>
              <button type="button" onClick={() => void onSaveStatus("reviewed")} disabled={isLoading || !result}>
                Mark Reviewed
              </button>
              <button type="button" onClick={() => void onSaveStatus("finalized")} disabled={isLoading || !result}>
                Finalize
              </button>
              <button type="button" onClick={onReset} disabled={isLoading}>
                Clear Form
              </button>
            </div>
          </form>
          {isLoading && showSlowNotice ? (
            <p className="appraisal-cannot">
              Still generating. Large prompts can take 10-20 seconds.
            </p>
          ) : null}
          {error ? <p className="appraisal-error">{error}</p> : null}
        </section>

        <section className="appraisal-output-panel">
          <div className="appraisal-output-head">
            <div>
              <h2>Draft Preview</h2>
              <p>Use this output for internal review, copy, and export.</p>
            </div>
            <div className="appraisal-export-actions">
              <button type="button" disabled={!result} onClick={() => void copy("text", plainText)}>
                Copy Text
              </button>
              <button type="button" disabled={!result} onClick={() => void copy("json", jsonText)}>
                Copy JSON
              </button>
              <button
                type="button"
                disabled={!result}
                onClick={() => exportFile("appraisal-draft.txt", plainText, "Exported TXT.")}
              >
                Export TXT
              </button>
              <button
                type="button"
                disabled={!result}
                onClick={() => exportFile("appraisal-draft.json", jsonText, "Exported JSON.")}
              >
                Export JSON
              </button>
            </div>
          </div>

          {feedback ? <p className="appraisal-copied">{feedback}</p> : null}

          {!result ? (
            <div className="appraisal-empty">
              Generate a draft to preview structured appraisal output.
            </div>
          ) : (
            <div className="appraisal-draft">
              <p className="appraisal-assistant">{result.assistant_message}</p>
              <p>
                <strong>Source:</strong> {result.source_type}
              </p>
              <p>
                <strong>Persisted:</strong> {result.persisted ? "yes" : "no"}
              </p>
              <p>
                <strong>Completeness score:</strong> {result.quality.completeness_score}
              </p>
              <p>
                <strong>Missing required:</strong>{" "}
                {result.quality.missing_required_fields.join(", ") || "-"}
              </p>
              <p>
                <strong>Missing recommended:</strong>{" "}
                {result.quality.missing_recommended_fields.join(", ") || "-"}
              </p>

              {result.mode === "cannot_generate" || !result.draft ? (
                <div className="appraisal-cannot">
                  {result.notes ?? "No draft available with current inputs."}
                </div>
              ) : (
                <>
                  <section>
                    <h3>Header</h3>
                    <p>
                      <strong>Customer:</strong> {result.draft.header.customer_name ?? "-"}
                    </p>
                    <p>
                      <strong>Contact:</strong> {result.draft.header.customer_contact ?? "-"}
                    </p>
                    <p>
                      <strong>Date:</strong> {result.draft.header.appraisal_date ?? "-"}
                    </p>
                    <p>
                      <strong>Rug Label:</strong> {result.draft.header.rug_label ?? "-"}
                    </p>
                    <p>
                      <strong>Rug Size:</strong> {result.draft.header.rug_size_text ?? "-"}
                    </p>
                  </section>

                  <section>
                    <h3>Description</h3>
                    <ul>
                      {result.draft.description_paragraphs.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  </section>

                  <section>
                    <h3>Value Section</h3>
                    <p>
                      <strong>{result.draft.value_section.label}:</strong>{" "}
                      {typeof result.draft.value_section.amount === "number"
                        ? `${result.draft.value_section.amount} ${result.draft.value_section.currency ?? ""}`.trim()
                        : "-"}
                    </p>
                    <p>{result.draft.value_section.statement}</p>
                  </section>

                  <section>
                    <h3>Disclaimers</h3>
                    <ul>
                      {result.draft.disclaimers.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  </section>
                </>
              )}
            </div>
          )}

          <div className="appraisal-panel-head">
            <h2>Recent Drafts</h2>
            <p>{draftsLoading ? "Loading..." : `${draftRows.length} loaded`}</p>
          </div>
          <div className="appraisal-draft-list">
            {draftRows.map((draft) => (
              <button
                key={draft.id}
                type="button"
                className="appraisal-draft-row"
                onClick={() => onLoadDraft(draft)}
              >
                <strong>{draft.customer_name ?? draft.external_rug_label ?? draft.id.slice(0, 8)}</strong>
                <span>{draft.status}</span>
                <span>{draft.updated_at}</span>
              </button>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
