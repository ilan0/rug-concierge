import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { RecommendationCard } from "@/components/concierge/recommendation-card";
import type { Turn } from "@/components/concierge/types";
import {
  formatTime,
  type StarterPrompt,
} from "@/components/concierge/utils";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ChatThreadProps = {
  turns: Turn[];
  isLoading: boolean;
  showSlowNotice: boolean;
  emptyStatePrompts: StarterPrompt[];
  bodyTextClassName: string;
  onChoosePrompt: (prompt: StarterPrompt) => void;
  onJumpToLatestVisibilityChange?: (visible: boolean) => void;
  onJumpToLatestHandlerChange?: (handler: (() => void) | null) => void;
};

const ROLE_LABEL: Record<Turn["role"], string> = {
  user: "You",
  assistant: "Concierge",
};

export function ChatThread(input: ChatThreadProps) {
  const {
    turns,
    isLoading,
    showSlowNotice: _showSlowNotice,
    emptyStatePrompts,
    bodyTextClassName,
    onChoosePrompt,
    onJumpToLatestVisibilityChange,
    onJumpToLatestHandlerChange,
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
    const thresholdPx = 56;
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
      <section className="flex flex-col gap-7">
        {turns.length === 0 ? (
          <article className="max-w-full rounded-3xl border border-border/60 bg-background/60 px-5 py-5 shadow-[0_2px_16px_rgba(36,20,5,0.09)]">
            <p className={cn("whitespace-pre-wrap text-foreground", bodyTextClassName)}>
              What are you looking for today?
            </p>
            <div className="mt-5 flex flex-row flex-wrap justify-center gap-2">
              {emptyStatePrompts.map((prompt) => (
                <button
                  key={prompt.id}
                  type="button"
                  className="h-9 rounded-full border border-border/50 bg-transparent px-4 text-sm font-medium text-foreground/70 transition-colors hover:border-primary/45 hover:bg-primary/8 hover:text-foreground"
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
                    ? "group ml-auto max-w-[92%] rounded-3xl border border-border/45 bg-[#e7dccf]/82 px-6 py-5 shadow-[0_1px_2px_rgba(50,30,12,0.12)] sm:max-w-[86%]"
                    : "group max-w-full rounded-3xl border border-border/45 bg-background/58 px-4 py-4 sm:px-5 sm:py-5"
                }
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-[11px] font-semibold tracking-[0.08em] text-muted-foreground">
                    {ROLE_LABEL[turn.role]}
                  </p>
                  <time className="text-[11px] text-muted-foreground opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
                    {formatTime(turn.createdAt)}
                  </time>
                </div>

                {turn.role === "assistant" ? (
                  <div
                    className={cn(
                      "text-foreground [&_li]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:whitespace-pre-wrap [&_ul]:list-disc [&_ul]:pl-5",
                      hasRecommendations
                        ? bodyTextClassName
                        : "max-w-[72ch] text-[17px] leading-[1.62] sm:text-[18px] sm:leading-[1.65]"
                    )}
                  >
                    <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>
                      {turn.text}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <p className={cn("whitespace-pre-wrap text-foreground", bodyTextClassName)}>
                    {turn.text}
                  </p>
                )}

                {turn.role === "assistant" && turn.questions && turn.questions.length > 0 ? (
                  <div className="mt-5 rounded-xl border border-primary/30 bg-primary/8 p-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.08em] text-foreground/80">
                      Clarifying Questions
                    </p>
                    <ul className="mt-1.5 list-disc space-y-1 pl-5 text-[17px] leading-[1.55] text-foreground/90">
                      {turn.questions.map((question) => (
                        <li key={question}>{question}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {hasRecommendations ? (
                  <div className="mt-6">
                    <div className="mb-2 hidden items-center justify-end gap-2 md:flex">
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="h-8 w-8 rounded-full"
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
                        className="h-8 w-8 rounded-full"
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
                      className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2 [scrollbar-width:thin]"
                    >
                      {turn.recommendations?.map((item) => (
                        <div
                          key={item.rug_id}
                          className="min-w-[82%] snap-start sm:min-w-[360px] md:min-w-[400px] lg:min-w-[430px]"
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

        {isLoading ? (
          <article className="rounded-3xl bg-background/60 p-5">
            <div className="h-3 w-full animate-pulse rounded-md bg-muted" />
            <div className="mt-2 h-3 w-2/3 animate-pulse rounded-md bg-muted" />
          </article>
        ) : null}
      </section>
    </section>
  );
}
