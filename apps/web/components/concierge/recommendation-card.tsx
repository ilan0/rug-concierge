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
    <Card className="overflow-hidden rounded-3xl border-border/55 bg-background/80 shadow-[0_2px_10px_rgba(35,22,8,0.08)]">
      <div className="aspect-[4/3] w-full overflow-hidden bg-muted">
        <RugImage
          src={item.primary_image_url}
          alt={item.primary_image_caption ?? item.title}
          placeholderLabel="No rug image"
        />
      </div>
      <CardHeader className="pb-1 pt-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-[22px] leading-[1.25]">{item.title}</CardTitle>
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
      <CardContent className="space-y-4 pb-5 pt-1 text-[17px] leading-[1.6] md:min-h-[300px] lg:min-h-[320px]">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
          <p className="space-y-1">
            <span className="block text-[12px] font-semibold uppercase tracking-[0.08em] text-foreground/70">
              Size
            </span>
            <span className="block whitespace-nowrap text-[28px] font-medium leading-[1.15] sm:text-[32px]">
              {item.size_text ?? "-"}
            </span>
          </p>
          <p className="space-y-1">
            <span className="block text-[12px] font-semibold uppercase tracking-[0.08em] text-foreground/70">
              Price
            </span>
            <span className="block whitespace-nowrap text-[32px] font-semibold leading-[1.15] sm:text-[36px]">
              {formatPrice(item.price_usd)}
            </span>
          </p>
        </div>

        <div>
          <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-foreground/70">
            Why this fits
          </p>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-[18px] leading-[1.6]">
            {visibleReasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
