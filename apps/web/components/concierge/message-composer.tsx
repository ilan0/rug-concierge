import { useEffect, useRef, type FormEvent } from "react";
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

  return (
    <section
      data-concierge-composer="true"
      data-floating-composer={floating ? "true" : "false"}
      className={
        floating
          ? "fixed bottom-0 z-40 -translate-x-1/2 [text-size-adjust:100%] [-webkit-text-size-adjust:100%]"
          : "relative z-30 mx-auto mt-4 [text-size-adjust:100%] [-webkit-text-size-adjust:100%]"
      }
      style={
        floating
          ? {
              bottom: `${Math.max(0, bottomOffsetPx + restingOffsetPx)}px`,
              left: "calc(50% + (env(safe-area-inset-left, 0px) - env(safe-area-inset-right, 0px)) / 2)",
              width:
                "min(820px, calc(100vw - env(safe-area-inset-left, 0px) - env(safe-area-inset-right, 0px) - 1.5rem))",
            }
          : {
              width:
                "min(820px, calc(100vw - env(safe-area-inset-left, 0px) - env(safe-area-inset-right, 0px) - 1.5rem))",
            }
      }
    >
      {/* Outer wrapper — ref here so height includes pill + card + footer */}
      <div ref={containerRef} className="w-full">
        {/* New Chat pill */}
        {showNewChat ? (
          <div className="mb-1.5 flex justify-center animate-in fade-in duration-150">
            <button
              type="button"
              onClick={onNewChat}
              disabled={isNewChatDisabled}
              className={cn(
                "flex h-[34px] items-center gap-1.5 rounded-full border border-border/40 bg-transparent px-4 text-[13px] font-medium text-foreground/55 shadow-[0_1px_4px_rgba(36,20,5,0.07)] transition-colors",
                "hover:border-primary/40 hover:bg-primary/6 hover:text-foreground/80",
                "disabled:cursor-not-allowed disabled:opacity-40"
              )}
            >
              <RotateCcw className="size-[13px]" />
              New conversation
            </button>
          </div>
        ) : null}

        {/* Composer card */}
        <div
          className="w-full rounded-[20px] border border-border/70 bg-card/95 p-2 shadow-[0_12px_28px_rgba(42,27,11,0.16)] supports-[backdrop-filter:blur(0px)]:bg-card/88 supports-[backdrop-filter:blur(0px)]:backdrop-blur sm:p-2.5"
          style={{ paddingBottom: "calc(0.45rem + env(safe-area-inset-bottom, 0px))" }}
        >
          {showJumpToLatest && onJumpToLatest ? (
            <div className="mb-2 flex justify-end">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="h-9 w-9 rounded-full border border-border/55 bg-background/95 p-0 shadow-md backdrop-blur-sm transition-colors hover:bg-background sm:w-auto sm:px-3"
                aria-label="Jump to latest"
                onClick={onJumpToLatest}
              >
                <ArrowDown className="size-4 sm:hidden" />
                <span className="hidden sm:inline">Jump to latest</span>
              </Button>
            </div>
          ) : null}

          <form onSubmit={onSubmit}>
            <div className="flex items-end">
              <Textarea
                ref={textareaRef}
                value={message}
                onChange={(event) => onMessageChange(event.target.value)}
                placeholder="Describe what you're looking for…"
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

        {/* Powered by RugDesk */}
        <p className="pt-1.5 text-center text-[11px] select-none text-muted-foreground/35">
          Powered by RugDesk
        </p>
      </div>
    </section>
  );
}
