"use client";

import { useState } from "react";
import type { UiRecommendationItem } from "@/lib/types/chat-ui";
import { RugImage } from "@/components/ui/rug-image";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  RugDetailModal,
  type RugDetailData,
} from "@/components/concierge/rug-detail-modal";
import { toast } from "sonner";

type RecommendationCardProps = {
  item: UiRecommendationItem;
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
    (typeof data.primary_image_url === "string" || data.primary_image_url === null)
  );
}

export function RecommendationCard({
  item,
}: RecommendationCardProps) {
  const tags = [item.origin, item.style, item.mood].filter(
    (value): value is string => typeof value === "string" && value.trim().length > 0
  );

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

  const onShare = async () => {
    const title =
      detail?.effective_fields.label ??
      detail?.intake_label ??
      item.title ??
      "Rug recommendation";
    const sizeText = detail?.size_display ?? item.size_text ?? null;
    const descriptorText = [item.origin, item.style, item.mood]
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .join(" · ");
    const lines = [title];
    if (sizeText) lines.push(`Size: ${sizeText}`);
    if (descriptorText) lines.push(descriptorText);
    lines.push(`Rug ID: ${item.rug_id}`);
    if (typeof window !== "undefined") {
      lines.push(`${window.location.origin}/concierge`);
    }
    const shareText = lines.join("\n");

    if (
      typeof navigator !== "undefined" &&
      typeof navigator.share === "function"
    ) {
      try {
        await navigator.share({
          title,
          text: shareText,
          url:
            typeof window !== "undefined"
              ? `${window.location.origin}/concierge`
              : undefined,
        });
        toast.success("Rug details shared.");
        return;
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          return;
        }
      }
    }

    if (
      typeof navigator !== "undefined" &&
      navigator.clipboard &&
      typeof navigator.clipboard.writeText === "function"
    ) {
      try {
        await navigator.clipboard.writeText(shareText);
        toast.success("Rug details copied to clipboard.");
        return;
      } catch {
        // fall through to error toast
      }
    }

    toast.error("Sharing is unavailable on this device.");
  };

  return (
    <>
      <Card
        data-recommendation-card="true"
        className="cursor-pointer overflow-hidden rounded-3xl border-border/55 bg-background/82 shadow-[0_2px_10px_rgba(35,22,8,0.08)] transition hover:-translate-y-[1px] hover:border-primary/35 hover:shadow-[0_8px_20px_rgba(238,189,43,0.14)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45"
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
        <div className="h-60 w-full overflow-hidden bg-muted">
          <RugImage
            src={item.primary_image_url}
            alt={item.primary_image_caption ?? item.title}
            className="h-full w-full bg-muted/70 p-2"
            fit="contain"
            placeholderLabel="No rug image"
          />
        </div>
        <CardHeader className="pb-1 pt-3">
          <CardTitle className="line-clamp-2 text-[20px] leading-[1.25]">
            {item.title}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 pb-4 pt-1 text-[17px] leading-[1.6]">
          <p className="space-y-1.5">
            <span className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-primary">
              Size
            </span>
            <span className="block whitespace-nowrap text-lg font-medium leading-[1.2] sm:text-xl">
              {item.size_text ?? "-"}
            </span>
          </p>
          {tags.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {tags.slice(0, 2).map((tag) => (
                <span
                  key={`${item.rug_id}-${tag}`}
                  className="rounded-full border border-border/55 bg-background px-2.5 py-0.5 text-[11px] font-medium text-foreground/75"
                >
                  {tag}
                </span>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <RugDetailModal
        open={detailOpen}
        onOpenChange={setDetailOpen}
        isLoading={detailLoading}
        error={detailError}
        detail={detail}
        onShare={() => void onShare()}
      />
    </>
  );
}
