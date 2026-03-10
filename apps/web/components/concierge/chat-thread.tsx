import { useCallback, useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { RecommendationCard } from "@/components/concierge/recommendation-card";
import type { Turn } from "@/components/concierge/types";
import {
  formatTime,
  modeLabel,
  shouldRenderFollowUpQuestion,
} from "@/components/concierge/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ChatThreadProps = {
  turns: Turn[];
  isLoading: boolean;
  showSlowNotice: boolean;
  jumpBottomOffsetPx: number;
  isDeveloperView: boolean;
  emptyStatePrompts: string[];
  bodyTextClassName: string;
  onChoosePrompt: (prompt: string) => void;
  onSelectTurn: (turnId: string) => void;
};

function formatConstraintSummary(input: Turn["constraintSnapshot"]) {
  if (!input) return [];

  const toFeetLabel = (inches: number): string => {
    const feet = Math.floor(inches / 12);
    const remainder = Math.round(inches - feet * 12);
    if (remainder === 0) return `${feet}'`;
    return `${feet}'${remainder}"`;
  };

  const items: string[] = [];
  if (input.hard_constraints.size) {
    items.push(
      `${toFeetLabel(input.hard_constraints.size.widthIn)} x ${toFeetLabel(input.hard_constraints.size.lengthIn)}${
        typeof input.hard_constraints.size.toleranceIn === "number"
          ? ` ±${input.hard_constraints.size.toleranceIn}"`
          : ""
      }`
    );
  }
  if (input.soft_preferences?.style) {
    items.push(`Style ${input.soft_preferences.style}`);
  }
  if (input.soft_preferences?.palette) {
    items.push(`Palette ${input.soft_preferences.palette}`);
  }
  return items.slice(0, 4);
}

export function ChatThread(input: ChatThreadProps) {
  const {
    turns,
    isLoading,
    showSlowNotice,
    jumpBottomOffsetPx,
    isDeveloperView,
    emptyStatePrompts,
    bodyTextClassName,
    onChoosePrompt,
    onSelectTurn,
  } = input;
  const [isPinnedToBottom, setIsPinnedToBottom] = useState(true);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);

  const latestTurnSignature = useMemo(
    () => turns.map((turn) => turn.id).join("|"),
    [turns]
  );

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
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "auto" });
  }, [latestTurnSignature, isLoading, isPinnedToBottom]);

  const jumpToLatest = () => {
    if (typeof window === "undefined") return;
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" });
    setIsPinnedToBottom(true);
    setShowJumpToLatest(false);
  };

  return (
    <section className="relative">
      <section className="flex flex-col gap-8">
        {turns.length === 0 ? (
          <article className="max-w-full rounded-3xl bg-background/55 px-5 py-5">
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                assistant
              </p>
            </div>
            <p className={cn("whitespace-pre-wrap text-foreground", bodyTextClassName)}>
              Tell me what kind of rug you&apos;re looking for.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              {emptyStatePrompts.map((prompt) => (
                <Button
                  key={prompt}
                  type="button"
                  variant="outline"
                  className="h-[52px] rounded-full border-border/55 bg-background/70 px-6 text-[18px] leading-[1.35] text-foreground"
                  onClick={() => onChoosePrompt(prompt)}
                >
                  {prompt}
                </Button>
              ))}
            </div>
          </article>
        ) : (
          turns.map((turn) => (
            <article
              key={turn.id}
              className={
                turn.role === "user"
                  ? "ml-auto max-w-[92%] rounded-3xl bg-[#e7dccf]/82 px-6 py-5 shadow-[0_1px_2px_rgba(50,30,12,0.12)] sm:max-w-[86%]"
                  : "max-w-full rounded-3xl bg-background/55 px-4 py-4 sm:px-5 sm:py-5"
              }
              onClick={() =>
                turn.role === "assistant" ? onSelectTurn(turn.id) : undefined
              }
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                  {turn.role}
                </p>
                <time className="text-[11px] text-muted-foreground">{formatTime(turn.createdAt)}</time>
              </div>

              {turn.role === "assistant" && turn.coarseMode === "recommendation" ? (
                <div className="mb-3 flex flex-wrap gap-2">
                  {formatConstraintSummary(turn.constraintSnapshot).map((item) => (
                    <Badge
                      key={`${turn.id}-${item}`}
                      variant="outline"
                      className="border-border/40 bg-background/60 px-2.5 py-1 text-[11px] font-medium text-foreground/80"
                    >
                      {item}
                    </Badge>
                  ))}
                </div>
              ) : null}

              {turn.role === "assistant" && turn.fineMode && isDeveloperView ? (
                <Badge variant="outline" className="mb-2 border-border/30 text-[10px] text-muted-foreground">
                  {modeLabel(turn.fineMode)}
                </Badge>
              ) : null}

              {turn.role === "assistant" ? (
                <div
                  className={cn(
                    "text-foreground [&_li]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:whitespace-pre-wrap [&_ul]:list-disc [&_ul]:pl-5",
                    bodyTextClassName
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

              {turn.role === "assistant" &&
              shouldRenderFollowUpQuestion(turn.text, turn.followUpQuestion) ? (
                <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.08em] text-amber-800">Suggested Next Step</p>
                  <p className="mt-1 text-sm text-amber-900">{turn.followUpQuestion}</p>
                </div>
              ) : null}

              {turn.role === "assistant" && turn.questions && turn.questions.length > 0 ? (
                <div className="mt-5">
                  <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Clarifying Questions</p>
                  <ul className="mt-1 list-disc space-y-1 pl-5 text-[18px] leading-[1.65]">
                    {turn.questions.map((question) => (
                      <li key={question}>{question}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {turn.role === "assistant" && turn.recommendations && turn.recommendations.length > 0 ? (
                <div className="mt-6 grid grid-cols-1 gap-5 md:grid-cols-2">
                  {turn.recommendations.map((item) => (
                    <RecommendationCard
                      item={item}
                      key={item.rug_id}
                      showTechnicalMeta={isDeveloperView}
                      maxVisibleReasons={2}
                    />
                  ))}
                </div>
              ) : null}
            </article>
          ))
        )}

        {isLoading ? (
          <article className="rounded-3xl bg-background/60 p-5">
            <div className="h-3 w-full animate-pulse rounded-md bg-muted" />
            <div className="mt-2 h-3 w-2/3 animate-pulse rounded-md bg-muted" />
            {showSlowNotice ? (
              <p className="mt-3 text-xs text-muted-foreground">
                Still working on this request. Large inventory queries may take 10-20 seconds.
              </p>
            ) : null}
          </article>
        ) : null}
      </section>

      {showJumpToLatest ? (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="fixed left-1/2 z-30 -translate-x-1/2 shadow-sm"
          style={{
            left: "calc(50% + (env(safe-area-inset-left, 0px) - env(safe-area-inset-right, 0px)) / 2)",
            bottom: `${jumpBottomOffsetPx + 12}px`,
          }}
          onClick={jumpToLatest}
        >
          Jump to latest
        </Button>
      ) : null}
    </section>
  );
}
