import type { UiRecommendationItem } from "@/lib/types/chat-ui";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type RecommendationCardProps = {
  item: UiRecommendationItem;
};

function formatPrice(value: number | null): string {
  if (typeof value !== "number") return "Price unavailable";
  return `$${value.toLocaleString()}`;
}

export function RecommendationCard({ item }: RecommendationCardProps) {
  return (
    <Card className="border-border/70 bg-background/70">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">{item.title}</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">SKU {item.sku ?? "-"}</p>
          </div>
          <Badge variant={item.confidence_tier === "high" ? "default" : item.confidence_tier === "medium" ? "warning" : "outline"}>
            {item.confidence_tier}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-0 text-sm">
        <div className="grid grid-cols-2 gap-3">
          <p><span className="block text-xs uppercase tracking-[0.08em] text-muted-foreground">Size</span>{item.size_text ?? "-"}</p>
          <p><span className="block text-xs uppercase tracking-[0.08em] text-muted-foreground">Price</span>{formatPrice(item.price_usd)}</p>
        </div>

        <div>
          <p className="text-xs uppercase tracking-[0.08em] text-muted-foreground">Why this fits</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {item.match_reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>

        {item.why_not.length > 0 ? (
          <div>
            <p className="text-xs uppercase tracking-[0.08em] text-muted-foreground">Tradeoffs</p>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              {item.why_not.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <p className="text-xs text-muted-foreground">
          Confidence {Math.round(item.confidence * 100)}%
          {item.confidence_factors.length > 0
            ? ` • ${item.confidence_factors.join(", ")}`
            : ""}
        </p>
      </CardContent>
    </Card>
  );
}
