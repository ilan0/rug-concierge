import type { FormEvent } from "react";
import type { ConciergeVariant } from "@/components/concierge/types";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

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
    <section className="sticky bottom-3 rounded-2xl border border-border bg-card/95 p-4 shadow-sm backdrop-blur">
      <form onSubmit={onSubmit} className="space-y-3">
        <Textarea
          value={message}
          onChange={(event) => onMessageChange(event.target.value)}
          placeholder={
            variant === "trade"
              ? "Type a trade or designer request..."
              : "Type your rug question or request..."
          }
          rows={3}
          maxLength={2000}
          disabled={isLoading}
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">
            {variant === "trade"
              ? "Trade context is included with each message."
              : "Enter to send, Shift+Enter for new line"}
          </span>
          <Button type="submit" disabled={!canSubmit}>
            {isLoading ? "Sending..." : "Send"}
          </Button>
        </div>
      </form>
      {error ? (
        <div className="mt-3 space-y-2">
          <Alert variant="destructive">
            <AlertTitle>Message failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
          <Button type="button" variant="outline" disabled={!canRetry || isLoading} onClick={onRetry}>
            Retry
          </Button>
        </div>
      ) : null}
    </section>
  );
}
