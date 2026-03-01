import type { UiRecommendationItem } from "@/lib/types/chat-ui";
import { RugImage } from "@/components/ui/rug-image";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type RecommendationCardProps = {
  item: UiRecommendationItem;
  showTechnicalMeta?: boolean;
  maxVisibleReasons?: number;
};

function formatPrice(value: number | null): string {
  if (typeof value !== "number") return "Price unavailable";
  return `$${value.toLocaleString()}`;
}

export function RecommendationCard({
  item,
  showTechnicalMeta = false,
  maxVisibleReasons,
}: RecommendationCardProps) {
  const visibleReasonCount =
    typeof maxVisibleReasons === "number"
      ? Math.max(0, maxVisibleReasons)
      : item.match_reasons.length;
  const visibleReasons = item.match_reasons.slice(0, visibleReasonCount);

  return (
    <Card className="overflow-hidden rounded-2xl border-border/40 bg-background/70 shadow-sm">
      <div className="aspect-[4/3] w-full overflow-hidden bg-muted">
        <RugImage
          src={item.primary_image_url}
          alt={item.primary_image_caption ?? item.title}
          placeholderLabel="No rug image"
        />
      </div>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-lg leading-6">{item.title}</CardTitle>
            {showTechnicalMeta ? (
              <p className="mt-1 text-xs text-muted-foreground">SKU {item.sku ?? "-"}</p>
            ) : null}
          </div>
          {showTechnicalMeta ? (
            <Badge
              variant={
                item.confidence_tier === "high"
                  ? "default"
                  : item.confidence_tier === "medium"
                    ? "warning"
                    : "outline"
              }
            >
              {item.confidence_tier}
            </Badge>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-0 text-[15px] leading-7">
        <div className="grid grid-cols-2 gap-4">
          <p>
            <span className="block text-xs uppercase tracking-[0.08em] text-muted-foreground">Size</span>
            {item.size_text ?? "-"}
          </p>
          <p>
            <span className="block text-xs uppercase tracking-[0.08em] text-muted-foreground">Price</span>
            {formatPrice(item.price_usd)}
          </p>
        </div>

        <div>
          <p className="text-xs uppercase tracking-[0.08em] text-muted-foreground">Why this fits</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {visibleReasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
