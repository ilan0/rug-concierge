"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChatThread } from "@/components/concierge/chat-thread";
import { MessageComposer } from "@/components/concierge/message-composer";
import { useConciergeController } from "@/components/concierge/use-concierge-controller";
import { useVisualViewportInset } from "@/components/concierge/use-visual-viewport-inset";
import type { ConciergeVariant } from "@/components/concierge/types";
import { SiteHeader } from "@/components/ui/site-header";

type ConciergeScreenProps = {
  variant?: ConciergeVariant;
  tenantId: string;
  storeName: string;
  storeLogoUrl: string | null;
};

const BODY_SIZE = "text-[18px] leading-[1.65]";
const COMPOSER_REST_OFFSET_DESKTOP = 12;
const COMPOSER_REST_OFFSET_MOBILE = 8;
const CONTENT_SAFETY_GAP = 10;
const INITIAL_COMPOSER_HEIGHT = 92;
// Accounts for the New Chat pill (34px) + its bottom gap (10px) above the composer card.
const NEW_CHAT_PILL_CLEARANCE_PX = 20;

const RAIL_STYLE = {
  width:
    "min(820px, calc(100vw - env(safe-area-inset-left, 0px) - env(safe-area-inset-right, 0px) - 1.5rem))",
} as const;

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
  const shouldFloatComposer = !isHeroState;

  const composerRestOffsetPx = isSmallViewport
    ? COMPOSER_REST_OFFSET_MOBILE
    : COMPOSER_REST_OFFSET_DESKTOP;

  const composerClearancePx = useMemo(() => {
    if (!shouldFloatComposer) return CONTENT_SAFETY_GAP;
    const pillExtra = hasMessages ? NEW_CHAT_PILL_CLEARANCE_PX : 0;
    return (
      Math.max(
        INITIAL_COMPOSER_HEIGHT + CONTENT_SAFETY_GAP,
        composerHeightPx + keyboardInsetPx + composerRestOffsetPx + CONTENT_SAFETY_GAP
      ) + pillExtra
    );
  }, [composerHeightPx, keyboardInsetPx, composerRestOffsetPx, shouldFloatComposer, hasMessages]);

  return (
    <>
      <SiteHeader storeName={storeName} storeLogoUrl={storeLogoUrl} />

      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(circle_at_12%_8%,rgba(255,241,218,0.55),transparent_40%),radial-gradient(circle_at_88%_12%,rgba(236,219,198,0.35),transparent_42%),linear-gradient(180deg,rgba(250,245,238,0.88),rgba(244,236,225,0.9))]"
      />

      <main
        className="relative pt-[48px] [text-size-adjust:100%] [-webkit-text-size-adjust:100%]"
        style={{ minHeight: "calc(100dvh - 48px)" }}
      >
        {isHeroState ? (
          // Hero: fills available space below header; centers content vertically.
          <div className="flex min-h-[calc(100dvh-48px)] flex-col items-center justify-center py-8">
            <div className="mx-auto w-full" style={RAIL_STYLE}>
              {/* Welcome moment */}
              <div className="mb-8 text-center [text-size-adjust:100%] [-webkit-text-size-adjust:100%]">
                <h1 className="font-serif text-[38px] font-semibold tracking-tight text-foreground sm:text-[44px]">
                  {storeName}
                </h1>
                <p className="mt-2 text-[15px] font-light italic text-muted-foreground">
                  Every piece in the collection, at your fingertips.
                </p>
              </div>

              {/* Unified card: greeting + chips + composer as one surface */}
              <div className="overflow-hidden rounded-3xl border border-border/60 bg-background/60 shadow-[0_2px_16px_rgba(36,20,5,0.09)]">
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
                <div className="px-3 pb-3 pt-0">
                  <MessageComposer
                    variant={variant}
                    message={controller.message}
                    isLoading={controller.isLoading}
                    canSubmit={controller.canSubmit}
                    error={controller.error}
                    canRetry={Boolean(controller.lastFailedMessage)}
                    bottomOffsetPx={0}
                    restingOffsetPx={0}
                    onHeightChange={onComposerHeightChange}
                    onMessageChange={controller.setMessage}
                    onSubmit={controller.onSubmit}
                    onRetry={() => void controller.onRetryLastMessage()}
                    showJumpToLatest={false}
                    floating={false}
                    showNewChat={false}
                    isNewChatDisabled={false}
                    onNewChat={() => void controller.onNewChat()}
                  />
                </div>
              </div>
            </div>
          </div>
        ) : (
          // Active: scrolling chat; floating composer rendered outside <main> below.
          <div
            className="mx-auto pb-6 [text-size-adjust:100%] [-webkit-text-size-adjust:100%]"
            style={RAIL_STYLE}
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
