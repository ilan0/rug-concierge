"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChatThread } from "@/components/concierge/chat-thread";
import { MessageComposer } from "@/components/concierge/message-composer";
import { StoreHeroLockup } from "@/components/concierge/store-hero-lockup";
import { useConciergeController } from "@/components/concierge/use-concierge-controller";
import { useVisualViewportInset } from "@/components/concierge/use-visual-viewport-inset";
import type { ConciergeVariant } from "@/components/concierge/types";
import { SiteHeader } from "@/components/ui/site-header";
import { cn } from "@/lib/utils";

type ConciergeScreenProps = {
  variant?: ConciergeVariant;
  tenantId: string;
  storeName: string;
  storeLogoUrl: string | null;
};

const BODY_SIZE = "text-[18px] leading-7 sm:text-[19px] sm:leading-[30px]";
const COMPOSER_REST_OFFSET_DESKTOP = 12;
const COMPOSER_REST_OFFSET_MOBILE = 8;
const CONTENT_SAFETY_GAP = 20;
const INITIAL_COMPOSER_HEIGHT = 104;
// Accounts for the New Chat pill (34px) + its bottom gap (10px) above the composer card.
const NEW_CHAT_PILL_CLEARANCE_PX = 20;

export function ConciergeScreen({
  variant = "concierge",
  tenantId,
  storeName,
  storeLogoUrl,
}: ConciergeScreenProps) {
  const controller = useConciergeController({ variant, tenantId });
  const keyboardInsetPx = useVisualViewportInset();
  const [composerHeightPx, setComposerHeightPx] = useState(INITIAL_COMPOSER_HEIGHT);
  const [isSmallViewport, setIsSmallViewport] = useState(false);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [jumpToLatest, setJumpToLatest] = useState<(() => void) | null>(null);
  const [heroTransitioning, setHeroTransitioning] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mediaQuery = window.matchMedia("(max-width: 640px)");
    const sync = () => setIsSmallViewport(mediaQuery.matches);
    sync();
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", sync);
      return () => mediaQuery.removeEventListener("change", sync);
    }
    mediaQuery.addListener(sync);
    return () => mediaQuery.removeListener(sync);
  }, []);

  const onComposerHeightChange = useCallback((nextHeight: number) => {
    setComposerHeightPx((prev) => (prev === nextHeight ? prev : nextHeight));
  }, []);
  const onJumpToLatestHandlerChange = useCallback(
    (handler: (() => void) | null) => {
      setJumpToLatest(() => handler);
    },
    []
  );

  const hasMessages = controller.turns.length > 0;
  const isHeroState = controller.turns.length === 0 && !controller.isLoading;
  const shouldFloatComposer = true;

  const composerRestOffsetPx = isSmallViewport
    ? COMPOSER_REST_OFFSET_MOBILE
    : COMPOSER_REST_OFFSET_DESKTOP;

  useEffect(() => {
    if (!hasMessages) {
      setHeroTransitioning(false);
      return;
    }
    setHeroTransitioning(true);
    const timer = window.setTimeout(() => setHeroTransitioning(false), 160);
    return () => window.clearTimeout(timer);
  }, [hasMessages]);

  const composerClearancePx = useMemo(() => {
    const pillExtra = hasMessages ? NEW_CHAT_PILL_CLEARANCE_PX : 0;
    return (
      Math.max(
        INITIAL_COMPOSER_HEIGHT + CONTENT_SAFETY_GAP,
        composerHeightPx + keyboardInsetPx + composerRestOffsetPx + CONTENT_SAFETY_GAP
      ) + pillExtra
    );
  }, [composerHeightPx, keyboardInsetPx, composerRestOffsetPx, hasMessages]);

  return (
    <>
      <SiteHeader
        storeName={storeName}
        storeLogoUrl={storeLogoUrl}
        showBranding={!isHeroState && !heroTransitioning}
      />

      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(circle_at_12%_8%,rgba(255,241,218,0.55),transparent_40%),radial-gradient(circle_at_88%_12%,rgba(236,219,198,0.35),transparent_42%),linear-gradient(180deg,rgba(250,245,238,0.88),rgba(244,236,225,0.9))]"
      />

      <main
        className="relative pt-14 [text-size-adjust:100%] [-webkit-text-size-adjust:100%] sm:pt-16"
        style={{ minHeight: "calc(100dvh - 56px)" }}
      >
        {isHeroState || heroTransitioning ? (
          // Hero: fills available space below header; centers content vertically.
          <div className={cn("flex min-h-[calc(100dvh-56px)] flex-col items-center justify-center py-8 sm:min-h-[calc(100dvh-64px)] sm:py-10 transition-opacity duration-150", hasMessages ? "opacity-0" : "opacity-100")}>
            <div className="mx-auto w-[calc(100vw-24px)] max-w-[920px] sm:w-[min(860px,calc(100vw-40px))] xl:w-[920px]">
              {/* Welcome moment */}
              <div className="mb-8 px-2 [text-size-adjust:100%] [-webkit-text-size-adjust:100%] sm:mb-10 sm:px-4">
                <StoreHeroLockup storeName={storeName} storeLogoUrl={storeLogoUrl} />
              </div>

              {/* Unified card: greeting + chips as one surface */}
              <div className="overflow-hidden rounded-3xl border border-[var(--border-primary)] bg-[var(--surface)] shadow-[0_8px_24px_rgba(35,24,10,0.08)]">
                <ChatThread
                  turns={controller.turns}
                  isLoading={controller.isLoading}
                  showSlowNotice={controller.showSlowNotice}
                  emptyStatePrompts={controller.starterPrompts}
                  bodyTextClassName={BODY_SIZE}
                  onChoosePrompt={controller.submitWithPrompt}
                  onJumpToLatestVisibilityChange={setShowJumpToLatest}
                  onJumpToLatestHandlerChange={onJumpToLatestHandlerChange}
                  bareEmptyState={true}
                />
              </div>
            </div>
          </div>
        ) : (
          // Active: scrolling chat; floating composer rendered outside <main> below.
          <div
            className="mx-auto w-[calc(100vw-24px)] max-w-[920px] pb-6 [text-size-adjust:100%] [-webkit-text-size-adjust:100%] sm:w-[min(860px,calc(100vw-40px))] xl:w-[920px] concierge-bubble-enter"
          >
            <ChatThread
              turns={controller.turns}
              isLoading={controller.isLoading}
              showSlowNotice={controller.showSlowNotice}
              emptyStatePrompts={controller.starterPrompts}
              bodyTextClassName={BODY_SIZE}
              onChoosePrompt={controller.submitWithPrompt}
              onJumpToLatestVisibilityChange={setShowJumpToLatest}
              onJumpToLatestHandlerChange={onJumpToLatestHandlerChange}
            />

            <div aria-hidden="true" style={{ height: `${composerClearancePx}px` }} />
          </div>
        )}
      </main>

      {/* Floating composer lives outside <main> so it never affects scroll width */}
      {shouldFloatComposer ? (
        <MessageComposer
          variant={variant}
          message={controller.message}
          isLoading={controller.isLoading}
          canSubmit={controller.canSubmit}
          error={controller.error}
          canRetry={Boolean(controller.lastFailedMessage)}
          bottomOffsetPx={keyboardInsetPx}
          restingOffsetPx={composerRestOffsetPx}
          onHeightChange={onComposerHeightChange}
          onMessageChange={controller.setMessage}
          onSubmit={controller.onSubmit}
          onRetry={() => void controller.onRetryLastMessage()}
          showJumpToLatest={showJumpToLatest}
          onJumpToLatest={jumpToLatest ?? undefined}
          floating={true}
          showNewChat={hasMessages && !controller.isLoading}
          isNewChatDisabled={controller.isLoading || controller.isResettingChat}
          onNewChat={() => void controller.onNewChat()}
        />
      ) : null}
    </>
  );
}
