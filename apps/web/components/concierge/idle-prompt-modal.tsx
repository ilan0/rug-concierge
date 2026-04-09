"use client";

import { Clock3 } from "lucide-react";

type IdlePromptModalProps = {
  open: boolean;
  onContinue: () => void;
  onStartOver: () => void;
};

export function IdlePromptModal({ open, onContinue, onStartOver }: IdlePromptModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 top-14 z-40 sm:top-16" role="presentation">
      <div className="absolute inset-0 bg-[var(--scrim)]" />
      <div className="relative mx-auto flex h-full w-full max-w-[920px] items-center justify-center px-4">
        <section
          role="dialog"
          aria-modal="true"
          aria-labelledby="idle-prompt-title"
          aria-describedby="idle-prompt-body"
          className="w-[min(560px,92vw)] max-w-[420px] rounded-[30px] border border-[var(--border)] bg-[var(--surface)] p-[22px] shadow-[0_22px_44px_rgba(25,16,9,0.24)] sm:max-w-[560px] sm:p-7"
        >
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full border border-[var(--accent-gold-soft)] bg-[var(--surface-2)] text-[var(--accent-gold)]">
            <Clock3 className="h-5 w-5" />
          </div>

          <h2
            id="idle-prompt-title"
            className="mt-4 text-center font-serif text-[34px] leading-[36px] tracking-tight text-[var(--text-primary)] sm:text-[56px] sm:leading-[58px] lg:text-[46px] lg:leading-[48px]"
          >
            Still with us?
          </h2>
          <p
            id="idle-prompt-body"
            className="mt-3 text-center text-[18px] leading-7 text-[var(--text-secondary)] sm:text-[22px] sm:leading-8 lg:text-[19px] lg:leading-[30px]"
          >
            This kiosk has been idle for 5 minutes. Your conversation is still saved.
          </p>

          <div className="mt-6 flex flex-col gap-3">
            <button
              type="button"
              onClick={onContinue}
              className="h-14 min-h-11 w-full rounded-2xl bg-[var(--accent-gold)] px-4 text-[18px] font-medium leading-5 text-[var(--text-primary)] transition hover:bg-[var(--accent-gold-hover)] active:scale-[0.995] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-gold)] focus-visible:ring-offset-2"
            >
              Continue Chat
            </button>
            <button
              type="button"
              onClick={onStartOver}
              className="h-[46px] min-h-11 w-full rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] px-4 text-[16px] font-medium leading-5 text-[var(--text-secondary)] transition hover:border-[var(--accent-gold-soft)] active:scale-[0.995] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-gold)] focus-visible:ring-offset-2"
            >
              Start Over
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

