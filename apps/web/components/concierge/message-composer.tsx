import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ArrowDown, RotateCcw } from "lucide-react";
import type { ConciergeVariant } from "@/components/concierge/types";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

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
  showJumpToLatest?: boolean;
  onJumpToLatest?: () => void;
  floating?: boolean;
  showNewChat?: boolean;
  isNewChatDisabled?: boolean;
  onNewChat?: () => void;
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
    showJumpToLatest = false,
    onJumpToLatest,
    floating = true,
    showNewChat = false,
    isNewChatDisabled = false,
    onNewChat,
  } = input;
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  // Measures the full wrapper height (pill + card + footer) for clearance calculation.
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isCompactViewport, setIsCompactViewport] = useState(false);

  const handleTextareaKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    if (event.nativeEvent.isComposing) return;
    if (!canSubmit || isLoading) return;
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mediaQuery = window.matchMedia("(max-width: 640px)");
    const sync = () => setIsCompactViewport(mediaQuery.matches);
    sync();
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", sync);
      return () => mediaQuery.removeEventListener("change", sync);
    }
    mediaQuery.addListener(sync);
    return () => mediaQuery.removeListener(sync);
  }, []);

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
  }, [onHeightChange, error, isLoading, message, bottomOffsetPx, restingOffsetPx, showNewChat]);

  const showJumpControl = showJumpToLatest && typeof onJumpToLatest === "function";
  const showNewChatControl =
    showNewChat && !isCompactViewport && (!showJumpControl || !isCompactViewport);

  return (
    <section
      data-concierge-composer="true"
      data-floating-composer={floating ? "true" : "false"}
      className={
        floating
          ? "fixed bottom-0 z-40 w-[calc(100vw-24px)] max-w-[920px] -translate-x-1/2 [text-size-adjust:100%] [-webkit-text-size-adjust:100%] sm:w-[min(860px,calc(100vw-40px))] xl:w-[920px]"
          : "relative z-30 w-full [text-size-adjust:100%] [-webkit-text-size-adjust:100%]"
      }
      style={
        floating
          ? {
              bottom: `${Math.max(0, bottomOffsetPx + restingOffsetPx)}px`,
              left: "calc(50% + (env(safe-area-inset-left, 0px) - env(safe-area-inset-right, 0px)) / 2)",
            }
          : undefined
      }
    >
      {/* Outer wrapper — ref here so height includes pill + card + footer */}
      <div ref={containerRef} className="w-full">
        {/* Composer card */}
        <div
          className="w-full rounded-[24px] border border-[var(--border-primary)] bg-[var(--surface)]/92 p-3 shadow-[0_12px_32px_rgba(42,27,11,0.12)] supports-[backdrop-filter:blur(0px)]:backdrop-blur-[8px] sm:p-4"
          style={{ minHeight: "104px", paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom, 0px))" }}
        >
          {showJumpControl || showNewChatControl ? (
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              {showNewChatControl ? (
                <button
                  type="button"
                  onClick={onNewChat}
                  disabled={isNewChatDisabled}
                  className={cn(
                    "concierge-hoverable flex h-11 min-w-[160px] items-center justify-center gap-2 rounded-[20px] border border-[var(--border-primary)] bg-[var(--surface)] px-4 text-[16px] font-medium leading-5 text-[var(--text-secondary)] transition active:scale-[0.995] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-gold)] focus-visible:ring-offset-2",
                    "disabled:cursor-not-allowed disabled:opacity-40"
                  )}
                >
                  <RotateCcw className="size-4" />
                  New conversation
                </button>
              ) : (
                <span />
              )}

              {showJumpControl ? (
                <button
                  type="button"
                  className="concierge-hoverable flex h-11 min-w-[152px] items-center justify-center gap-2 rounded-[20px] border border-[var(--border-primary)] bg-[var(--surface)] px-4 text-[16px] font-medium leading-5 text-[var(--text-secondary)] transition active:scale-[0.995] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-gold)] focus-visible:ring-offset-2"
                  aria-label="Jump to latest"
                  onClick={onJumpToLatest}
                >
                  <ArrowDown className="size-4" />
                  <span>Jump to latest</span>
                </button>
              ) : null}
            </div>
          ) : null}

          <form onSubmit={onSubmit}>
            <div className="flex items-end gap-[10px]">
              <Textarea
                ref={textareaRef}
                value={message}
                onChange={(event) => onMessageChange(event.target.value)}
                onKeyDown={handleTextareaKeyDown}
                placeholder="Describe what you're looking for…"
                rows={1}
                maxLength={2000}
                disabled={isLoading}
                className="min-h-[56px] resize-none rounded-2xl border-[var(--border-primary)] bg-[var(--surface-2)] px-4 py-3 text-[18px] leading-7 text-[var(--text-primary)] placeholder:text-[color:var(--text-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-gold)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)]"
              />
              <Button
                type="submit"
                disabled={!canSubmit}
                className="h-14 min-w-24 shrink-0 rounded-2xl border border-[var(--accent-gold-soft)] bg-[var(--accent-gold-soft)] px-5 text-[16px] font-medium leading-5 text-[var(--text-primary)] transition hover:bg-[var(--accent-gold)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-gold)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isLoading ? "Sending..." : "Send"}
              </Button>
            </div>
          </form>
          {error ? (
            <div className="mt-3 space-y-3">
              <Alert className="border-[var(--error-border-warm)] bg-[var(--error-bg-warm)] text-[var(--error-text-warm)]">
                <AlertTitle className="text-[16px] font-semibold leading-5">Message failed</AlertTitle>
                <AlertDescription className="text-[15px] leading-6">{error}</AlertDescription>
              </Alert>
              <Button type="button" variant="outline" className="min-h-11 border-[var(--error-border-warm)] text-[var(--error-text-warm)]" disabled={!canRetry || isLoading} onClick={onRetry}>
                Retry message
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
