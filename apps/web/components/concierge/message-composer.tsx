import type { FormEvent } from "react";
import type { ConciergeVariant } from "@/components/concierge/types";

type MessageComposerProps = {
  variant: ConciergeVariant;
  message: string;
  isLoading: boolean;
  canSubmit: boolean;
  error: string | null;
  onMessageChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

export function MessageComposer(input: MessageComposerProps) {
  const {
    variant,
    message,
    isLoading,
    canSubmit,
    error,
    onMessageChange,
    onSubmit,
  } = input;

  return (
    <section className="concierge-input-wrap">
      <form onSubmit={onSubmit} className="concierge-form">
        <textarea
          value={message}
          onChange={(event) => onMessageChange(event.target.value)}
          placeholder={
            variant === "trade"
              ? "Type a trade/design request..."
              : "Type your rug request..."
          }
          rows={3}
          maxLength={2000}
          disabled={isLoading}
        />
        <div className="concierge-form-actions">
          <span className="concierge-hint">
            {variant === "trade"
              ? "Trade context is included with each message."
              : "Enter to send, Shift+Enter for new line"}
          </span>
          <button type="submit" disabled={!canSubmit}>
            {isLoading ? "Sending..." : "Send"}
          </button>
        </div>
      </form>
      {error ? <p className="concierge-error">{error}</p> : null}
    </section>
  );
}
