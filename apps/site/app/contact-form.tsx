"use client";

import { FormEvent, useState } from "react";

const CONTACT_RECIPIENT = "ilan.nabatkhorian@outlook.com";
const CONTACT_ENDPOINT = `https://formsubmit.co/ajax/${CONTACT_RECIPIENT}`;

type FormStatus =
  | { type: "idle" }
  | { type: "submitting" }
  | { type: "success"; message: string }
  | { type: "error"; message: string };

const initialStatus: FormStatus = { type: "idle" };

export function ContactForm() {
  const [status, setStatus] = useState<FormStatus>(initialStatus);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const form = event.currentTarget;
    if (!form.reportValidity()) return;

    const formData = new FormData(form);
    const honey = String(formData.get("company_website") ?? "").trim();
    if (honey.length > 0) {
      setStatus({
        type: "success",
        message: "Thanks. Your note was received.",
      });
      form.reset();
      return;
    }

    setStatus({ type: "submitting" });

    formData.append("_subject", "New Rugdesk site inquiry");
    formData.append("_captcha", "false");
    formData.append("_template", "table");

    try {
      const response = await fetch(CONTACT_ENDPOINT, {
        method: "POST",
        body: formData,
        headers: {
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`Contact request failed with status ${response.status}`);
      }

      setStatus({
        type: "success",
        message:
          "Thanks. We will get back to you shortly.",
      });
      form.reset();
    } catch (error) {
      console.error(error);
      setStatus({
        type: "error",
        message:
          "The form could not send right now. Please email hello@rugdesk.app instead.",
      });
    }
  }

  return (
    <form className="contact-form" onSubmit={handleSubmit} noValidate>
      <input type="hidden" name="_cc" value="" />
      <p className="form-note">
        Send a note and we will reach out with the right next step for your
        showroom.
      </p>

      <div className="contact-grid">
        <label className="field">
          <span>Name</span>
          <input autoComplete="name" name="name" required type="text" />
        </label>

        <label className="field">
          <span>Store name</span>
          <input autoComplete="organization" name="store_name" required type="text" />
        </label>

        <label className="field">
          <span>Email</span>
          <input autoComplete="email" name="email" required type="email" />
        </label>

        <label className="field">
          <span>Phone</span>
          <input autoComplete="tel" name="phone" required type="tel" />
        </label>

        <label className="field field-full">
          <span>Message</span>
          <textarea
            name="message"
            required
            rows={5}
            placeholder="Tell us a little about your showroom and what you want to improve."
          />
        </label>
      </div>

      <label className="field field-honeypot" aria-hidden="true" tabIndex={-1}>
        <span>Company website</span>
        <input autoComplete="off" name="company_website" type="text" tabIndex={-1} />
      </label>

      <div className="contact-submit-row">
        <button
          className="button button-primary button-submit"
          disabled={status.type === "submitting"}
          type="submit"
        >
          {status.type === "submitting" ? "Sending..." : "Send message"}
        </button>

        <div className="form-status" aria-live="polite">
          {status.type === "success" ? (
            <p className="status-message status-success">{status.message}</p>
          ) : null}
          {status.type === "error" ? (
            <p className="status-message status-error">{status.message}</p>
          ) : null}
        </div>
      </div>
    </form>
  );
}
