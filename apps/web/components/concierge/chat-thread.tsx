import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { RecommendationCard } from "@/components/concierge/recommendation-card";
import { RugSpinner } from "@/components/concierge/rug-spinner";
import type { Turn } from "@/components/concierge/types";
import {
  formatTime,
  type StarterPrompt,
} from "@/components/concierge/utils";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function RugLoadingState() {
  return (
    <div className="rounded-[24px] border border-[var(--active-border)] bg-[var(--active-assistant)] px-5 py-5 shadow-[var(--active-shadow-1)] sm:px-6 sm:py-6">
      <div className="flex items-center gap-3">
        <RugSpinner size={28} />
        <span className="text-[15px] leading-5 tracking-[0.01em] text-[var(--active-text-soft)]">Searching the collection...</span>
      </div>
      <div className="mt-4 space-y-2.5">
        <div className="concierge-loading-line h-4 w-[72%] rounded bg-[var(--active-surface-2)]" />
        <div className="concierge-loading-line h-4 w-[46%] rounded bg-[var(--active-surface-2)]" />
      </div>
    </div>
  );
}

type ChatThreadProps = {
  turns: Turn[];
  isLoading: boolean;
  showSlowNotice?: boolean;
  emptyStatePrompts: StarterPrompt[];
  bodyTextClassName: string;
  onChoosePrompt: (prompt: StarterPrompt) => void;
  onJumpToLatestVisibilityChange?: (visible: boolean) => void;
  onJumpToLatestHandlerChange?: (handler: (() => void) | null) => void;
  /** When true, suppresses card border/bg/shadow so the caller can wrap in its own surface. */
  bareEmptyState?: boolean;
};

const ROLE_LABEL: Record<Turn["role"], string> = {
  user: "You",
  assistant: "Concierge",
};

export function ChatThread(input: ChatThreadProps) {
  const {
    turns,
    isLoading,
    emptyStatePrompts,
    bodyTextClassName,
    onChoosePrompt,
    onJumpToLatestVisibilityChange,
    onJumpToLatestHandlerChange,
    bareEmptyState = false,
  } = input;
  const [isPinnedToBottom, setIsPinnedToBottom] = useState(true);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const hasCompletedInitialAutoScrollPass = useRef(false);
  const recommendationRowRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const latestTurnSignature = useMemo(
    () => turns.map((turn) => turn.id).join("|"),
    [turns]
  );
  const latestTurnRole = turns[turns.length - 1]?.role ?? null;

  const updatePinnedState = useCallback(() => {
    if (typeof window === "undefined") return;
    const doc = document.documentElement;
    const thresholdPx = 120;
    const distanceToBottom = doc.scrollHeight - (window.scrollY + window.innerHeight);
    const pinned = distanceToBottom <= thresholdPx;
    setIsPinnedToBottom(pinned);
    setShowJumpToLatest(!pinned && turns.length > 0);
  }, [turns.length]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const frame = window.requestAnimationFrame(updatePinnedState);
    window.addEventListener("scroll", updatePinnedState, { passive: true });
    window.addEventListener("resize", updatePinnedState);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", updatePinnedState);
      window.removeEventListener("resize", updatePinnedState);
    };
  }, [updatePinnedState]);

  useEffect(() => {
    if (typeof window === "undefined" || !isPinnedToBottom) return;
    if (!hasCompletedInitialAutoScrollPass.current) {
      hasCompletedInitialAutoScrollPass.current = true;
      return;
    }
    if (latestTurnRole !== "assistant") return;
    if (!isLoading && turns.length === 0) return;
    window.scrollTo({
      top: document.documentElement.scrollHeight,
      behavior: "smooth",
    });
  }, [
    latestTurnRole,
    latestTurnSignature,
    isLoading,
    isPinnedToBottom,
    turns.length,
  ]);

  const jumpToLatest = useCallback(() => {
    if (typeof window === "undefined") return;
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" });
    setIsPinnedToBottom(true);
    setShowJumpToLatest(false);
  }, []);

  const scrollRecommendationRow = useCallback(
    (turnId: string, direction: "left" | "right") => {
      const row = recommendationRowRefs.current[turnId];
      if (!row) return;
      const amount = Math.max(260, Math.round(row.clientWidth * 0.9));
      row.scrollBy({
        left: direction === "right" ? amount : -amount,
        behavior: "smooth",
      });
    },
    []
  );

  useEffect(() => {
    onJumpToLatestVisibilityChange?.(showJumpToLatest);
  }, [showJumpToLatest, onJumpToLatestVisibilityChange]);

  useEffect(() => {
    onJumpToLatestHandlerChange?.(jumpToLatest);
    return () => onJumpToLatestHandlerChange?.(null);
  }, [jumpToLatest, onJumpToLatestHandlerChange]);

  return (
    <section className="relative">
      <section className="flex flex-col gap-6 sm:gap-6">
        {turns.length === 0 ? (
          <article
            className={
              bareEmptyState
                ? "max-w-full px-[22px] py-[22px] sm:px-7 sm:py-7"
                : "max-w-full rounded-[26px] border border-[var(--active-border)] bg-[var(--active-surface)] px-[22px] py-[22px] shadow-[var(--active-shadow-1)] sm:px-7 sm:py-7"
            }
          >
            <p className="whitespace-pre-wrap font-serif text-[34px] leading-[1.12] tracking-[-0.013em] text-[var(--active-text)] sm:text-[40px] sm:leading-[1.08]">
              What are you looking for today?
            </p>
            <div className="mt-6 flex flex-row flex-wrap justify-center gap-3">
              {emptyStatePrompts.map((prompt) => (
                <button
                  key={prompt.id}
                  type="button"
                  className="min-h-[46px] rounded-[23px] border border-[var(--active-border)] bg-[color:color-mix(in_srgb,var(--active-surface)_90%,white)] px-5 text-[15px] font-medium leading-5 tracking-[0.01em] text-[var(--active-text-soft)] transition active:scale-[0.995] disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--active-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--active-surface)] concierge-hoverable"
                  onClick={() => onChoosePrompt(prompt)}
                >
                  {prompt.label}
                </button>
              ))}
            </div>
          </article>
        ) : (
          turns.map((turn) => {
            const hasRecommendations =
              turn.role === "assistant" &&
              Array.isArray(turn.recommendations) &&
              turn.recommendations.length > 0;

            return (
              <article
                key={turn.id}
                className={
                  turn.role === "user"
                    ? "group concierge-bubble-enter ml-auto max-w-[88%] rounded-[24px] border border-[var(--active-border)] bg-[var(--active-user)] px-5 py-5 shadow-[var(--active-shadow-1)] sm:max-w-[78%] sm:px-6 sm:py-[22px]"
                    : turn.isStreaming && turn.text === ""
                      ? "group concierge-bubble-enter max-w-full rounded-[24px] border border-[var(--active-border)] bg-[var(--active-assistant)] px-5 py-5 shadow-[var(--active-shadow-1)] sm:px-6 sm:py-[22px]"
                      : "group concierge-bubble-enter max-w-full rounded-[24px] border border-[var(--active-border)] bg-[var(--active-assistant)] px-5 py-5 shadow-[var(--active-shadow-1)] sm:px-6 sm:py-[22px]"
                }
              >
                {!(turn.role === "assistant" && turn.isStreaming && turn.text === "") && (
                  <div className="mb-[10px] flex items-center justify-between gap-2">
                    {turn.role === "user" ? (
                      <p className="text-[13px] font-medium leading-[18px] tracking-[0.04em] text-[var(--active-text-soft)]">
                        {ROLE_LABEL[turn.role]}
                      </p>
                    ) : (
                      <div />
                    )}
                    <time className="text-[13px] leading-[18px] tracking-[0.01em] text-[var(--active-text-soft)] opacity-70 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
                      {formatTime(turn.createdAt)}
                    </time>
                  </div>
                )}

                {turn.role === "assistant" ? (
                  turn.isStreaming && turn.text === "" ? (
                    <RugLoadingState />
                  ) : (
                    <div
                      className={cn(
                        "text-foreground [&_li]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:whitespace-pre-wrap [&_ul]:list-disc [&_ul]:pl-5",
                        hasRecommendations
                          ? bodyTextClassName
                          : "max-w-[72ch] text-[18px] leading-7 text-[var(--active-text)] sm:text-[19px] sm:leading-[30px]"
                      )}
                    >
                      <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>
                        {turn.text}
                      </ReactMarkdown>
                      {turn.isStreaming && (
                        <span className="ml-0.5 inline-block h-[1.1em] w-[2px] animate-pulse bg-foreground/40 align-text-bottom" />
                      )}
                    </div>
                  )
                ) : (
                  <p className={cn("whitespace-pre-wrap text-[var(--active-text)]", bodyTextClassName)}>
                    {turn.text}
                  </p>
                )}

                {turn.role === "assistant" && turn.questions && turn.questions.length > 0 ? (
                  <div className="mt-5 rounded-2xl border border-[var(--accent-gold-soft)] bg-[color:color-mix(in_srgb,var(--active-surface)_90%,white)] p-4">
                    <p className="text-[13px] font-semibold leading-5 tracking-[0.08em] text-[var(--active-text)]">
                      Clarifying Questions
                    </p>
                    <ul className="mt-2 list-disc space-y-1.5 pl-5 text-[18px] leading-7 text-[var(--active-text)]">
                      {turn.questions.map((question) => (
                        <li key={question}>{question}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {hasRecommendations ? (
                  <div className="mt-5">
                    <div className="mb-2 hidden items-center justify-end gap-2 md:flex">
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="h-11 w-11 rounded-full border-[var(--active-border)] bg-[var(--active-surface)] text-[var(--active-text-soft)] transition hover:border-[var(--active-border-strong)] hover:bg-[var(--active-surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--active-accent)] focus-visible:ring-offset-2"
                        onClick={(event) => {
                          event.stopPropagation();
                          scrollRecommendationRow(turn.id, "left");
                        }}
                      >
                        <ChevronLeft className="h-4 w-4" />
                        <span className="sr-only">Scroll recommendations left</span>
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="h-11 w-11 rounded-full border-[var(--active-border)] bg-[var(--active-surface)] text-[var(--active-text-soft)] transition hover:border-[var(--active-border-strong)] hover:bg-[var(--active-surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--active-accent)] focus-visible:ring-offset-2"
                        onClick={(event) => {
                          event.stopPropagation();
                          scrollRecommendationRow(turn.id, "right");
                        }}
                      >
                        <ChevronRight className="h-4 w-4" />
                        <span className="sr-only">Scroll recommendations right</span>
                      </Button>
                    </div>
                    <div
                      ref={(element) => {
                        recommendationRowRefs.current[turn.id] = element;
                      }}
                      className="concierge-rail flex gap-[18px] overflow-x-auto pb-2 [scrollbar-width:thin]"
                    >
                      {turn.recommendations?.map((item) => (
                        <div
                          key={item.rug_id}
                          className="min-w-[292px] max-w-[292px] snap-start sm:min-w-[420px] sm:max-w-[420px]"
                        >
                          <RecommendationCard
                            item={item}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </article>
            );
          })
        )}

      </section>
    </section>
  );
}
