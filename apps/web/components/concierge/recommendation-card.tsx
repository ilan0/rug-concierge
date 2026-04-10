"use client";

import { useEffect, useRef, useState } from "react";
import type { UiRecommendationItem } from "@/lib/types/chat-ui";
import { RugImage } from "@/components/ui/rug-image";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  RugDetailModal,
  type RugDetailData,
} from "@/components/concierge/rug-detail-modal";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

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
  const cardRef = useRef<HTMLDivElement | null>(null);
  const tapTimerRef = useRef<number | null>(null);
  const focusTimerRef = useRef<number | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detail, setDetail] = useState<RugDetailData | null>(null);
  const [isTapActive, setIsTapActive] = useState(false);
  const [isFocusPulse, setIsFocusPulse] = useState(false);

  useEffect(() => {
    return () => {
      if (tapTimerRef.current) window.clearTimeout(tapTimerRef.current);
      if (focusTimerRef.current) window.clearTimeout(focusTimerRef.current);
    };
  }, []);

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
    setIsTapActive(true);
    if (tapTimerRef.current) window.clearTimeout(tapTimerRef.current);
    tapTimerRef.current = window.setTimeout(() => setIsTapActive(false), 180);
    setDetailOpen(true);
    void loadDetail();
  };

  const onModalOpenChange = (open: boolean) => {
    setDetailOpen(open);
    if (!open) {
      cardRef.current?.focus();
      setIsFocusPulse(true);
      if (focusTimerRef.current) window.clearTimeout(focusTimerRef.current);
      focusTimerRef.current = window.setTimeout(() => setIsFocusPulse(false), 800);
    }
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
        ref={cardRef}
        data-recommendation-card="true"
        className={cn(
          "concierge-hoverable relative z-[1] cursor-pointer overflow-hidden rounded-[24px] border border-[var(--active-border)] bg-[var(--active-surface)] shadow-[var(--active-shadow-1)] transition duration-150 active:scale-[0.995] hover:z-[30] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--active-accent)] focus-visible:ring-offset-2",
          (isTapActive || isFocusPulse) &&
            "border-[var(--active-border-strong)] ring-2 ring-[color:rgba(201,161,74,0.28)] ring-offset-2 ring-offset-[var(--active-surface)]"
        )}
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
        <div className="aspect-[4/3] w-full overflow-hidden bg-[var(--active-surface-2)]">
          <RugImage
            src={item.primary_image_url}
            alt={item.primary_image_caption ?? item.title}
            className="h-full w-full"
            fit="cover"
            placeholderLabel="No rug image"
          />
        </div>
        <CardHeader className="pb-2 pt-[18px] sm:pt-[22px]">
          <CardTitle className="line-clamp-2 text-[30px] font-medium leading-[34px] tracking-[-0.015em] text-[var(--active-text)] sm:text-[38px] sm:leading-[40px]">
            {item.title}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 pb-[18px] pt-1 sm:pb-[22px]">
          <p className="space-y-1">
            <span className="block text-[12px] font-semibold uppercase leading-[18px] tracking-[0.08em] text-[var(--active-text-soft)]">
              Size
            </span>
            <span className="block whitespace-nowrap text-[26px] font-medium leading-[30px] text-[var(--active-text)] sm:text-[30px] sm:leading-[34px]">
              {item.size_text ?? "-"}
            </span>
          </p>
        </CardContent>
      </Card>

      <RugDetailModal
        open={detailOpen}
        onOpenChange={onModalOpenChange}
        isLoading={detailLoading}
        error={detailError}
        detail={detail}
        onShare={() => void onShare()}
      />
    </>
  );
}
