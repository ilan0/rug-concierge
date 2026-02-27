import { useEffect, useMemo, useRef, useState } from "react";
import { RecommendationCard } from "@/components/concierge/recommendation-card";
import type { Turn } from "@/components/concierge/types";
import {
  formatTime,
  modeLabel,
  shouldRenderFollowUpQuestion,
} from "@/components/concierge/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type ChatThreadProps = {
  turns: Turn[];
  isLoading: boolean;
  showSlowNotice: boolean;
  onSelectTurn: (turnId: string) => void;
};

export function ChatThread(input: ChatThreadProps) {
  const { turns, isLoading, showSlowNotice, onSelectTurn } = input;
  const containerRef = useRef<HTMLElement | null>(null);
  const [isPinnedToBottom, setIsPinnedToBottom] = useState(true);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);

  const latestTurnSignature = useMemo(
    () => turns.map((turn) => turn.id).join("|"),
    [turns]
  );

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const thresholdPx = 40;
    const distanceToBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
    const pinned = distanceToBottom <= thresholdPx;
    setIsPinnedToBottom(pinned);
    setShowJumpToLatest(!pinned);
  }, [latestTurnSignature, isLoading]);

  useEffect(() => {
    const node = containerRef.current;
    if (!node || !isPinnedToBottom) return;
    node.scrollTop = node.scrollHeight;
  }, [latestTurnSignature, isLoading, isPinnedToBottom]);

  const onScroll = () => {
    const node = containerRef.current;
    if (!node) return;
    const thresholdPx = 40;
    const distanceToBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
    const pinned = distanceToBottom <= thresholdPx;
    setIsPinnedToBottom(pinned);
    setShowJumpToLatest(!pinned);
  };

  const jumpToLatest = () => {
    const node = containerRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
    setIsPinnedToBottom(true);
    setShowJumpToLatest(false);
  };

  return (
    <section className="relative">
      <section
        className="flex max-h-[58vh] flex-col gap-3 overflow-y-auto rounded-2xl border border-border bg-card/70 p-3"
        ref={containerRef}
        onScroll={onScroll}
      >
        {turns.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-background/70 p-4 text-sm text-muted-foreground">
            Ask naturally: “show me 8x10 rugs under $2500” or “tell me about rug care.”
          </div>
        ) : (
          turns.map((turn) => (
            <article
              key={turn.id}
              className={
                turn.role === "user"
                  ? "rounded-xl border border-sky-200 bg-sky-50/75 p-4"
                  : "rounded-xl border border-border bg-background/85 p-4"
              }
              onClick={() =>
                turn.role === "assistant" ? onSelectTurn(turn.id) : undefined
              }
            >
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">{turn.role}</p>
                <time className="text-xs text-muted-foreground">{formatTime(turn.createdAt)}</time>
              </div>

              {turn.role === "assistant" && turn.fineMode ? (
                <Badge variant="outline" className="mb-2">
                  {modeLabel(turn.fineMode)}
                </Badge>
              ) : null}

              <p className="whitespace-pre-wrap text-sm leading-6">{turn.text}</p>

              {turn.role === "assistant" &&
              shouldRenderFollowUpQuestion(turn.text, turn.followUpQuestion) ? (
                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.08em] text-amber-800">Suggested Next Step</p>
                  <p className="mt-1 text-sm text-amber-900">{turn.followUpQuestion}</p>
                </div>
              ) : null}

              {turn.role === "assistant" && turn.questions && turn.questions.length > 0 ? (
                <div className="mt-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Clarifying Questions</p>
                  <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
                    {turn.questions.map((question) => (
                      <li key={question}>{question}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {turn.role === "assistant" && turn.recommendations && turn.recommendations.length > 0 ? (
                <div className="mt-3 grid gap-3">
                  {turn.recommendations.map((item) => (
                    <RecommendationCard item={item} key={item.rug_id} />
                  ))}
                </div>
              ) : null}
            </article>
          ))
        )}

        {isLoading ? (
          <article className="rounded-xl border border-border bg-background/90 p-4">
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
          className="absolute bottom-3 left-1/2 -translate-x-1/2"
          onClick={jumpToLatest}
        >
          Jump to latest
        </Button>
      ) : null}
    </section>
  );
}
