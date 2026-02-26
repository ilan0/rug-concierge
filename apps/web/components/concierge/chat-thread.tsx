import { useEffect, useMemo, useRef, useState } from "react";
import { RecommendationCard } from "@/components/concierge/recommendation-card";
import type { Turn } from "@/components/concierge/types";
import {
  formatTime,
  modeLabel,
  shouldRenderFollowUpQuestion,
} from "@/components/concierge/utils";

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
    <section className="concierge-thread" ref={containerRef} onScroll={onScroll}>
      {turns.length === 0 ? (
        <div className="concierge-empty">
          Ask naturally: “show me 8x10 rugs under $2500” or “tell me about rug
          care.”
        </div>
      ) : (
        turns.map((turn) => (
          <article
            key={turn.id}
            className={
              turn.role === "user"
                ? "concierge-turn concierge-turn-user"
                : "concierge-turn concierge-turn-assistant"
            }
            onClick={() =>
              turn.role === "assistant" ? onSelectTurn(turn.id) : undefined
            }
          >
            <div className="concierge-turn-top">
              <p className="concierge-turn-role">{turn.role}</p>
              <time>{formatTime(turn.createdAt)}</time>
            </div>
            {turn.role === "assistant" && turn.fineMode ? (
              <p className="ui-badge concierge-mode-chip">{modeLabel(turn.fineMode)}</p>
            ) : null}
            <p>{turn.text}</p>

            {turn.role === "assistant" &&
            shouldRenderFollowUpQuestion(turn.text, turn.followUpQuestion) ? (
              <div className="concierge-follow-up-block">
                <strong>Suggested Next Step</strong>
                <p>{turn.followUpQuestion}</p>
              </div>
            ) : null}

            {turn.role === "assistant" && turn.questions && turn.questions.length > 0 ? (
              <div className="concierge-question-block">
                <strong>Clarifying Questions</strong>
                <ul>
                  {turn.questions.map((question) => (
                    <li key={question}>{question}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {turn.role === "assistant" &&
            turn.recommendations &&
            turn.recommendations.length > 0 ? (
              <div className="concierge-rec-grid">
                {turn.recommendations.map((item) => (
                  <RecommendationCard item={item} key={item.rug_id} />
                ))}
              </div>
            ) : null}
          </article>
        ))
      )}

      {isLoading ? (
        <article className="concierge-turn concierge-turn-assistant concierge-loading">
          <div className="concierge-loading-bar" />
          <div className="concierge-loading-bar short" />
          {showSlowNotice ? (
            <p className="concierge-hint">
              Still working on this request. Large inventory queries may take 10-20
              seconds.
            </p>
          ) : null}
        </article>
      ) : null}

      {showJumpToLatest ? (
        <button
          type="button"
          className="ui-pill concierge-jump-pill"
          onClick={jumpToLatest}
        >
          Jump to latest
        </button>
      ) : null}
    </section>
  );
}
