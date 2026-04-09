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
        className="concierge-hoverable relative z-[1] cursor-pointer overflow-hidden rounded-[24px] border border-[var(--border-primary)] bg-[var(--surface)] shadow-[0_8px_22px_rgba(35,22,8,0.08)] transition active:scale-[0.995] hover:z-[30] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-gold)] focus-visible:ring-offset-2"
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
        <div className="aspect-[4/3] w-full overflow-hidden bg-[var(--surface-2)]">
          <RugImage
            src={item.primary_image_url}
            alt={item.primary_image_caption ?? item.title}
            className="h-full w-full"
            fit="cover"
            placeholderLabel="No rug image"
          />
        </div>
        <CardHeader className="pb-1 pt-[18px] sm:pt-[22px]">
          <CardTitle className="line-clamp-2 text-[30px] font-semibold leading-[34px] tracking-tight text-[var(--text-primary)] sm:text-[34px] sm:leading-[38px]">
            {item.title}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 pb-[18px] pt-1 sm:pb-[22px]">
          <p className="space-y-1">
            <span className="block text-[14px] font-semibold uppercase leading-5 tracking-[0.06em] text-[var(--text-secondary)]">
              Size
            </span>
            <span className="block whitespace-nowrap text-[22px] font-medium leading-[1.25] text-[var(--text-primary)]">
              {item.size_text ?? "-"}
            </span>
          </p>
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
