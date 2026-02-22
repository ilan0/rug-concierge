import type { UiRecommendationItem } from "@/lib/types/chat-ui";

type RecommendationCardProps = {
  item: UiRecommendationItem;
};

function formatPrice(value: number | null): string {
  if (typeof value !== "number") return "Price unavailable";
  return `$${value.toLocaleString()}`;
}

export function RecommendationCard({ item }: RecommendationCardProps) {
  return (
    <article className="concierge-rec-card">
      <header className="concierge-rec-head">
        <div>
          <h4>{item.title}</h4>
          <p className="concierge-rec-sku">SKU {item.sku ?? "-"}</p>
        </div>
        <span className={`concierge-tier concierge-tier-${item.confidence_tier}`}>
          {item.confidence_tier}
        </span>
      </header>

      <div className="concierge-rec-meta-grid">
        <p>
          <strong>Size</strong>
          <span>{item.size_text ?? "-"}</span>
        </p>
        <p>
          <strong>Price</strong>
          <span>{formatPrice(item.price_usd)}</span>
        </p>
      </div>

      <div className="concierge-rec-section">
        <strong>Why this fits</strong>
        <ul>
          {item.match_reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      </div>

      {item.why_not.length > 0 ? (
        <div className="concierge-rec-section">
          <strong>Tradeoffs</strong>
          <ul>
            {item.why_not.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="concierge-rec-confidence">
        Confidence {Math.round(item.confidence * 100)}%
        {item.confidence_factors.length > 0
          ? ` • ${item.confidence_factors.join(", ")}`
          : ""}
      </p>
    </article>
  );
}
