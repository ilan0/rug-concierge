import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ArrowDown, RotateCcw } from "lucide-react";
import {
  CONCIERGE_CLASSNAMES,
  CONCIERGE_LAYOUT,
} from "@/components/concierge/design-system";
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
  const utilityRowVisible = showJumpControl || showNewChatControl;
  const utilityBottomMarginPx = utilityRowVisible ? 8 : 0;
  const dockVerticalPaddingPx = isCompactViewport ? 8 : 10;
  const dockMinHeightPx = isCompactViewport
    ? CONCIERGE_LAYOUT.dockMaxHeightMobilePx
    : CONCIERGE_LAYOUT.dockMaxHeightDesktopPx;

  return (
    <section
      data-concierge-composer="true"
      data-floating-composer={floating ? "true" : "false"}
      className={
        floating
          ? "fixed bottom-0 z-40 w-[calc(100vw-24px)] max-w-[940px] -translate-x-1/2 [text-size-adjust:100%] [-webkit-text-size-adjust:100%] sm:w-[min(860px,calc(100vw-40px))] xl:w-[940px]"
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
          className="w-full rounded-[20px] border border-[var(--active-border)] bg-[color:color-mix(in_srgb,var(--active-surface)_95%,transparent)] px-3 shadow-[0_8px_22px_rgba(46,34,24,0.08)] supports-[backdrop-filter:blur(0px)]:backdrop-blur-[8px]"
          style={{
            minHeight: `${dockMinHeightPx}px`,
            paddingTop: `${dockVerticalPaddingPx}px`,
            paddingBottom: `calc(${dockVerticalPaddingPx}px + env(safe-area-inset-bottom, 0px))`,
          }}
        >
          {utilityRowVisible ? (
            <div
              className="flex items-center justify-between gap-2"
              style={{ minHeight: "44px", marginBottom: `${utilityBottomMarginPx}px` }}
            >
              {showNewChatControl ? (
                <button
                  type="button"
                  onClick={onNewChat}
                  disabled={isNewChatDisabled}
                  className={cn(
                    "min-w-[146px]",
                    CONCIERGE_CLASSNAMES.utilityButton,
                    CONCIERGE_CLASSNAMES.focusRing,
                    "disabled:cursor-not-allowed disabled:opacity-40"
                  )}
                >
                  <RotateCcw className="size-[14px]" />
                  New conversation
                </button>
              ) : (
                <span />
              )}

              {showJumpControl ? (
                <button
                  type="button"
                  className={cn(
                    "min-w-[132px]",
                    CONCIERGE_CLASSNAMES.utilityButton,
                    CONCIERGE_CLASSNAMES.focusRing
                  )}
                  aria-label="Jump to latest"
                  onClick={onJumpToLatest}
                >
                  <ArrowDown className="size-[14px]" />
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
                className={cn(
                  "min-h-[56px] resize-none rounded-2xl border-[var(--active-border)] bg-[var(--active-surface-2)] px-4 py-3 text-[18px] leading-7 text-[var(--active-text)] placeholder:text-[color:var(--active-text-soft)] focus-visible:ring-offset-[var(--active-surface)]",
                  CONCIERGE_CLASSNAMES.focusRing
                )}
              />
              <Button
                type="submit"
                disabled={!canSubmit}
                className={cn(
                  "h-14 min-w-24 shrink-0 rounded-2xl border border-[var(--accent-gold-soft)] bg-[var(--active-accent)] px-5 text-[15px] font-semibold leading-5 tracking-[0.01em] text-[var(--active-text)] shadow-[0_8px_14px_rgba(185,146,62,0.2)] transition hover:bg-[var(--active-accent-hover)] disabled:cursor-not-allowed disabled:opacity-60",
                  CONCIERGE_CLASSNAMES.focusRing
                )}
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
