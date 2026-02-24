import { RecommendationCard } from "@/components/concierge/recommendation-card";
import type { Turn } from "@/components/concierge/types";
import { formatTime, modeLabel } from "@/components/concierge/utils";

type ChatThreadProps = {
  turns: Turn[];
  isLoading: boolean;
  showSlowNotice: boolean;
  onSelectTurn: (turnId: string) => void;
};

export function ChatThread(input: ChatThreadProps) {
  const { turns, isLoading, showSlowNotice, onSelectTurn } = input;

  return (
    <section className="concierge-thread">
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
            {turn.role === "assistant" && turn.responseMode ? (
              <p className="concierge-mode-chip">{modeLabel(turn.responseMode)}</p>
            ) : null}
            <p>{turn.text}</p>

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
    </section>
  );
}
