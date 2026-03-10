import { useEffect, useRef, type FormEvent } from "react";
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
  bottomOffsetPx: number;
  restingOffsetPx: number;
  onHeightChange: (heightPx: number) => void;
  onMessageChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onRetry: () => void;
};

export function MessageComposer(input: MessageComposerProps) {
  const {
    message,
    isLoading,
    canSubmit,
    error,
    canRetry,
    bottomOffsetPx,
    restingOffsetPx,
    onHeightChange,
    onMessageChange,
    onSubmit,
    onRetry,
  } = input;
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = textareaRef.current;
    if (!node) return;
    const isSmallViewport = window.matchMedia("(max-width: 640px)").matches;
    const maxHeight = isSmallViewport ? 132 : 160;
    node.style.height = "auto";
    const nextHeight = Math.min(node.scrollHeight, maxHeight);
    node.style.height = `${nextHeight}px`;
    node.style.overflowY = node.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [message]);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const emitHeight = () => {
      onHeightChange(Math.ceil(node.getBoundingClientRect().height));
    };

    emitHeight();
    const observer =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(emitHeight) : null;
    observer?.observe(node);
    window.addEventListener("resize", emitHeight);

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", emitHeight);
    };
  }, [onHeightChange, error, isLoading, message, bottomOffsetPx, restingOffsetPx]);

  return (
    <section
      className="fixed bottom-0 z-40 -translate-x-1/2 [text-size-adjust:100%] [-webkit-text-size-adjust:100%]"
      style={{
        bottom: `${Math.max(0, bottomOffsetPx + restingOffsetPx)}px`,
        left: "calc(50% + (env(safe-area-inset-left, 0px) - env(safe-area-inset-right, 0px)) / 2)",
        width:
          "min(820px, calc(100vw - env(safe-area-inset-left, 0px) - env(safe-area-inset-right, 0px) - 1.5rem))",
      }}
    >
      <div
        ref={containerRef}
        className="w-full rounded-[20px] border border-border/70 bg-card/96 p-2 shadow-[0_14px_34px_rgba(42,27,11,0.2)] supports-[backdrop-filter:blur(0px)]:bg-card/90 supports-[backdrop-filter:blur(0px)]:backdrop-blur sm:p-2.5"
        style={{ paddingBottom: "calc(0.45rem + env(safe-area-inset-bottom, 0px))" }}
      >
        <form onSubmit={onSubmit}>
          <div className="flex items-end">
            <Textarea
              ref={textareaRef}
              value={message}
              onChange={(event) => onMessageChange(event.target.value)}
              placeholder="Describe what you’re looking for…"
              rows={1}
              maxLength={2000}
              disabled={isLoading}
              className="min-h-[42px] resize-none border-border/40 bg-background/70 px-3 py-2 text-base leading-[1.55]"
            />
            <Button
              type="submit"
              disabled={!canSubmit}
              className="ml-2 h-[42px] shrink-0 rounded-xl px-4"
            >
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
      </div>
    </section>
  );
}
