"use client";

import { useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import {
  appraisalToPlainText,
  copyTextToClipboard,
  downloadTextFile,
  generateAppraisalDraftClient,
} from "@/lib/appraisal/client";
import type { AppraisalUiResult, AppraisalFormState } from "@/lib/types/appraisal-ui";
import { toAppraisalInput } from "@/lib/types/appraisal-ui";

const DEFAULT_FORM: AppraisalFormState = {
  status: "draft",
  customer_name: "",
  customer_contact: "",
  appraisal_date: "",
  rug_label: "",
  rug_size_text: "",
  condition: "",
  style: "",
  origin_country: "",
  materials: "",
  palette: "",
  motifs: "",
  appraised_value: "",
  currency: "USD",
  staff_notes: "",
};

function formatGeneratedAt(value: string | null): string {
  if (!value) return "Not generated yet";
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return "Not generated yet";
  return parsed.toLocaleString();
}

export function AppraisalScreen() {
  const [form, setForm] = useState<AppraisalFormState>(DEFAULT_FORM);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AppraisalUiResult | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [lastGeneratedAt, setLastGeneratedAt] = useState<string | null>(null);

  const plainText = useMemo(
    () => (result ? appraisalToPlainText(result) : ""),
    [result]
  );
  const jsonText = useMemo(
    () => (result ? JSON.stringify(result, null, 2) : ""),
    [result]
  );

  const onField =
    (field: keyof AppraisalFormState) =>
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      setForm((prev) => ({
        ...prev,
        [field]: event.target.value,
      }));
    };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setFeedback(null);
    setIsLoading(true);

    try {
      const payload = await generateAppraisalDraftClient(toAppraisalInput(form));
      setResult(payload);
      setLastGeneratedAt(new Date().toISOString());
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Unable to generate appraisal draft."
      );
    } finally {
      setIsLoading(false);
    }
  };

  const onReset = () => {
    setForm(DEFAULT_FORM);
    setResult(null);
    setError(null);
    setFeedback(null);
    setLastGeneratedAt(null);
  };

  const copy = async (label: "text" | "json", value: string) => {
    try {
      await copyTextToClipboard(value);
      setFeedback(label === "text" ? "Copied draft text." : "Copied raw JSON.");
      setTimeout(() => setFeedback((prev) => (prev ? null : prev)), 1400);
    } catch {
      setError("Unable to copy to clipboard.");
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
            Draft, review, and export appraisal output in a structured format that is
            ready for future PDF workflows.
          </p>
        </div>
        <div className="appraisal-role-chip">Role locked: store_staff</div>
      </header>

      <section className="appraisal-summary-chips" aria-label="Appraisal summary">
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
            <p>Capture only known details. Keep unknown fields blank.</p>
          </div>

          <form onSubmit={onSubmit} className="appraisal-form">
            <fieldset className="appraisal-form-group">
              <legend>Document</legend>
              <label>
                Status
                <select value={form.status} onChange={onField("status")}>
                  <option value="draft">draft</option>
                  <option value="finalized">finalized</option>
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
                Currency
                <input value={form.currency} onChange={onField("currency")} />
              </label>
            </fieldset>

            <fieldset className="appraisal-form-group">
              <legend>Client</legend>
              <label>
                Customer Name
                <input value={form.customer_name} onChange={onField("customer_name")} />
              </label>
              <label>
                Customer Contact
                <input
                  value={form.customer_contact}
                  onChange={onField("customer_contact")}
                />
              </label>
            </fieldset>

            <fieldset className="appraisal-form-group">
              <legend>Rug Details</legend>
              <label>
                Rug Label
                <input value={form.rug_label} onChange={onField("rug_label")} />
              </label>
              <label>
                Rug Size Text
                <input value={form.rug_size_text} onChange={onField("rug_size_text")} />
              </label>
              <label>
                Condition
                <input value={form.condition} onChange={onField("condition")} />
              </label>
              <label>
                Style
                <input value={form.style} onChange={onField("style")} />
              </label>
              <label>
                Origin Country
                <input
                  value={form.origin_country}
                  onChange={onField("origin_country")}
                />
              </label>
              <label>
                Materials
                <input value={form.materials} onChange={onField("materials")} />
              </label>
              <label>
                Palette
                <input value={form.palette} onChange={onField("palette")} />
              </label>
              <label>
                Motifs
                <input value={form.motifs} onChange={onField("motifs")} />
              </label>
            </fieldset>

            <fieldset className="appraisal-form-group">
              <legend>Value + Notes</legend>
              <label>
                Appraised Value
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={form.appraised_value}
                  onChange={onField("appraised_value")}
                />
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
              <button type="button" onClick={onReset} disabled={isLoading}>
                Clear Form
              </button>
            </div>
          </form>
          {error ? <p className="appraisal-error">{error}</p> : null}
        </section>

        <section className="appraisal-output-panel">
          <div className="appraisal-output-head">
            <div>
              <h2>Draft Preview</h2>
              <p>Use this output for internal review, copy, and export.</p>
            </div>
            <div className="appraisal-export-actions">
              <button
                type="button"
                disabled={!result}
                onClick={() => copy("text", plainText)}
              >
                Copy Text
              </button>
              <button
                type="button"
                disabled={!result}
                onClick={() => copy("json", jsonText)}
              >
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
                onClick={() =>
                  exportFile("appraisal-draft.json", jsonText, "Exported JSON.")
                }
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
                        ? `${result.draft.value_section.amount} ${
                            result.draft.value_section.currency ?? ""
                          }`.trim()
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

              <section>
                <h3>Missing Fields</h3>
                {result.missing_fields.length > 0 ? (
                  <ul>
                    {result.missing_fields.map((field) => (
                      <li key={field}>{field}</li>
                    ))}
                  </ul>
                ) : (
                  <p>None</p>
                )}
              </section>

              <details>
                <summary>Technical Details</summary>
                <pre>{jsonText}</pre>
              </details>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
