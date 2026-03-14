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
  isDeveloperView: boolean;
  emptyStatePrompts: string[];
  bodyTextClassName: string;
  onChoosePrompt: (prompt: string) => void;
  onSelectTurn: (turnId: string) => void;
  onJumpToLatestVisibilityChange?: (visible: boolean) => void;
  onJumpToLatestHandlerChange?: (handler: (() => void) | null) => void;
};

const ROLE_LABEL: Record<Turn["role"], string> = {
  user: "You",
  assistant: "Concierge",
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
    isDeveloperView,
    emptyStatePrompts,
    bodyTextClassName,
    onChoosePrompt,
    onSelectTurn,
    onJumpToLatestVisibilityChange,
    onJumpToLatestHandlerChange,
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

  const jumpToLatest = useCallback(() => {
    if (typeof window === "undefined") return;
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" });
    setIsPinnedToBottom(true);
    setShowJumpToLatest(false);
  }, []);

  useEffect(() => {
    onJumpToLatestVisibilityChange?.(showJumpToLatest);
  }, [showJumpToLatest, onJumpToLatestVisibilityChange]);

  useEffect(() => {
    onJumpToLatestHandlerChange?.(jumpToLatest);
    return () => onJumpToLatestHandlerChange?.(null);
  }, [jumpToLatest, onJumpToLatestHandlerChange]);

  return (
    <section className="relative">
      <section className="flex flex-col gap-8">
        {turns.length === 0 ? (
          <article className="max-w-full rounded-3xl bg-background/55 px-5 py-5">
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="text-[11px] font-semibold tracking-[0.08em] text-muted-foreground">
                Concierge
              </p>
            </div>
            <p className={cn("whitespace-pre-wrap text-foreground", bodyTextClassName)}>
              Tell me what kind of rug you&apos;re looking for.
            </p>
            <div className="mt-5 flex max-w-full flex-col gap-3 sm:max-w-[42rem] sm:flex-row sm:flex-wrap">
              {emptyStatePrompts.map((prompt) => (
                <Button
                  key={prompt}
                  type="button"
                  variant="outline"
                  className="h-auto min-h-[52px] w-full justify-start whitespace-normal break-words rounded-full border-border/55 bg-background/70 px-6 py-3 text-left text-[18px] leading-[1.35] text-foreground hover:border-primary/50 hover:bg-primary/10 hover:text-foreground sm:w-auto sm:max-w-full sm:justify-center sm:text-center"
                  onClick={() => onChoosePrompt(prompt)}
                >
                  {prompt}
                </Button>
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
                    ? "group ml-auto max-w-[92%] rounded-3xl bg-[#e7dccf]/82 px-6 py-5 shadow-[0_1px_2px_rgba(50,30,12,0.12)] sm:max-w-[86%]"
                    : "group max-w-full rounded-3xl bg-background/55 px-4 py-4 sm:px-5 sm:py-5"
                }
                onClick={() =>
                  turn.role === "assistant" ? onSelectTurn(turn.id) : undefined
                }
                tabIndex={turn.role === "assistant" ? 0 : undefined}
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-[11px] font-semibold tracking-[0.08em] text-muted-foreground">
                    {ROLE_LABEL[turn.role]}
                  </p>
                  <time className="text-[11px] text-muted-foreground opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
                    {formatTime(turn.createdAt)}
                  </time>
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

                {hasRecommendations ? (
                  <div className="mt-6 grid grid-cols-1 gap-5 md:grid-cols-2 [&>*:last-child:nth-child(odd)]:md:col-span-2 [&>*:last-child:nth-child(odd)]:md:mx-auto [&>*:last-child:nth-child(odd)]:md:max-w-[calc(50%-10px)]">
                    {turn.recommendations?.map((item) => (
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
            );
          })
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
    </section>
  );
}
