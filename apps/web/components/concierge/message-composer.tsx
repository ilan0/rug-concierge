import type { FormEvent } from "react";
import type { ConciergeVariant } from "@/components/concierge/types";

type MessageComposerProps = {
  variant: ConciergeVariant;
  message: string;
  isLoading: boolean;
  canSubmit: boolean;
  error: string | null;
  canRetry: boolean;
  onMessageChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onRetry: () => void;
};

export function MessageComposer(input: MessageComposerProps) {
  const {
    variant,
    message,
    isLoading,
    canSubmit,
    error,
    canRetry,
    onMessageChange,
    onSubmit,
    onRetry,
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
          <button type="submit" disabled={!canSubmit} className="ui-btn--primary">
            {isLoading ? "Sending..." : "Send"}
          </button>
        </div>
      </form>
      {error ? (
        <div className="concierge-error-row">
          <p className="concierge-error">{error}</p>
          <button
            type="button"
            className="ui-btn--ghost"
            disabled={!canRetry || isLoading}
            onClick={onRetry}
          >
            Retry
          </button>
        </div>
      ) : null}
    </section>
  );
}
