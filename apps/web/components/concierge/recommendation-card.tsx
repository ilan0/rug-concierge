"use client";

import { useState } from "react";
import type { UiRecommendationItem } from "@/lib/types/chat-ui";
import { RugImage } from "@/components/ui/rug-image";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  RugDetailModal,
  type RugDetailData,
} from "@/components/concierge/rug-detail-modal";

type RecommendationCardProps = {
  item: UiRecommendationItem;
  showTechnicalMeta?: boolean;
  maxVisibleReasons?: number;
};

function isRugDetailData(value: unknown): value is RugDetailData {
  if (!value || typeof value !== "object") return false;
  const data = value as Record<string, unknown>;
  const effectiveFieldsValid =
    typeof data.effective_fields === "object" &&
    data.effective_fields !== null &&
    !Array.isArray(data.effective_fields) &&
    typeof (data.effective_fields as { label?: unknown }).label === "string";

  return (
    typeof data.id === "string" &&
    (typeof data.intake_label === "string" || data.intake_label === null) &&
    typeof data.size_display === "string" &&
    effectiveFieldsValid &&
    (typeof data.ai_description === "string" || data.ai_description === null) &&
    (typeof data.contextual_blurb === "string" || data.contextual_blurb === null) &&
    (typeof data.primary_image_url === "string" || data.primary_image_url === null)
  );
}

export function RecommendationCard({
  item,
  showTechnicalMeta = false,
  maxVisibleReasons,
}: RecommendationCardProps) {
  const tags = [item.origin, item.style, item.mood].filter(
    (value): value is string => typeof value === "string" && value.trim().length > 0
  );
  const visibleReasonCount =
    typeof maxVisibleReasons === "number"
      ? Math.max(0, maxVisibleReasons)
      : item.match_reasons.length;
  const visibleReasons = item.match_reasons.slice(0, visibleReasonCount);

  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detail, setDetail] = useState<RugDetailData | null>(null);

  const loadDetail = async () => {
    if (detailLoading || detail) return;
    setDetailLoading(true);
    setDetailError(null);

    try {
      const response = await fetch(`/api/rugs/${encodeURIComponent(item.rug_id)}`);
      if (!response.ok) {
        throw new Error("Could not load this rug right now.");
      }

      const payload = (await response.json().catch(() => null)) as unknown;
      if (!isRugDetailData(payload)) {
        throw new Error("Unexpected rug detail response.");
      }

      setDetail(payload);
    } catch (error) {
      setDetailError(
        error instanceof Error ? error.message : "Could not load this rug right now."
      );
    } finally {
      setDetailLoading(false);
    }
  };

  const onOpenDetails = () => {
    setDetailOpen(true);
    void loadDetail();
  };

  return (
    <>
      <Card
        className="cursor-pointer overflow-hidden rounded-3xl border-border/55 bg-background/80 shadow-[0_2px_10px_rgba(35,22,8,0.08)] transition hover:border-primary/35 hover:shadow-[0_4px_18px_rgba(238,189,43,0.12)]"
        onClick={onOpenDetails}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onOpenDetails();
          }
        }}
      >
        <div className="h-52 w-full overflow-hidden bg-muted">
          <RugImage
            src={item.primary_image_url}
            alt={item.primary_image_caption ?? item.title}
            className="h-full w-full object-cover"
            placeholderLabel="No rug image"
          />
        </div>
        <CardHeader className="pb-1 pt-4">
          <div className="flex items-start justify-between gap-3">
            <CardTitle className="text-[22px] leading-[1.25]">{item.title}</CardTitle>
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
          {tags.length > 0 ? (
            <p className="text-xs font-medium text-muted-foreground">
              {tags.slice(0, 3).join(" · ")}
            </p>
          ) : null}

          <p className="space-y-1">
            <span className="block text-[12px] font-semibold uppercase tracking-[0.08em] text-primary">
              Size
            </span>
            <span className="block whitespace-nowrap text-xl font-medium leading-[1.15] sm:text-2xl">
              {item.size_text ?? "-"}
            </span>
          </p>

          <div>
            <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-primary">
              Why this fits
            </p>
            <div className="mt-2 space-y-2 text-sm leading-relaxed md:min-h-[4.5rem]">
              {visibleReasons.map((reason) => (
                <p key={reason}>{reason}</p>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <RugDetailModal
        open={detailOpen}
        onOpenChange={setDetailOpen}
        isLoading={detailLoading}
        error={detailError}
        detail={detail}
      />
    </>
  );
}
