"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChatThread } from "@/components/concierge/chat-thread";
import { MessageComposer } from "@/components/concierge/message-composer";
import { useConciergeController } from "@/components/concierge/use-concierge-controller";
import { useVisualViewportInset } from "@/components/concierge/use-visual-viewport-inset";
import type { ConciergeVariant } from "@/components/concierge/types";
import { AppShell } from "@/components/ui/app-shell";
import { SiteHeader } from "@/components/ui/site-header";
import { cn } from "@/lib/utils";

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

  const composerRestOffsetPx = isSmallViewport
    ? COMPOSER_REST_OFFSET_MOBILE
    : COMPOSER_REST_OFFSET_DESKTOP;
  const shouldFloatComposer = !isHeroState;
  const composerClearancePx = useMemo(() => {
    if (!shouldFloatComposer) return CONTENT_SAFETY_GAP;
    return Math.max(
      INITIAL_COMPOSER_HEIGHT + CONTENT_SAFETY_GAP,
      composerHeightPx + keyboardInsetPx + composerRestOffsetPx + CONTENT_SAFETY_GAP
    );
  }, [composerHeightPx, keyboardInsetPx, composerRestOffsetPx, shouldFloatComposer]);
  const railStyle = useMemo(
    () => ({
      width:
        "min(820px, calc(100vw - env(safe-area-inset-left, 0px) - env(safe-area-inset-right, 0px) - 1.5rem))",
    }),
    []
  );
  const emptyStatePromptLimit = isSmallViewport ? 2 : 3;

  return (
    <>
      <SiteHeader
        storeName={storeName}
        storeLogoUrl={storeLogoUrl}
        showNewChat={hasMessages}
        isNewChatDisabled={controller.isLoading || controller.isResettingChat}
        onNewChat={() => void controller.onNewChat()}
      />
      <AppShell
        variant="conversational"
        className="relative min-h-[calc(100svh-2rem)] !min-h-[calc(100dvh-2rem)] !pt-14 pb-6 [text-size-adjust:100%] [-webkit-text-size-adjust:100%]"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(circle_at_12%_8%,rgba(255,241,218,0.55),transparent_40%),radial-gradient(circle_at_88%_12%,rgba(236,219,198,0.35),transparent_42%),linear-gradient(180deg,rgba(250,245,238,0.88),rgba(244,236,225,0.9))]"
        />

        <div
          className={cn(
            "mx-auto [text-size-adjust:100%] [-webkit-text-size-adjust:100%]",
            isHeroState ? "mt-2" : "mt-0"
          )}
          style={railStyle}
        >
          <ChatThread
            turns={controller.turns}
            isLoading={controller.isLoading}
            showSlowNotice={controller.showSlowNotice}
            emptyStatePrompts={controller.starterPrompts.slice(0, emptyStatePromptLimit)}
            bodyTextClassName={BODY_SIZE}
            onChoosePrompt={controller.submitWithPrompt}
            onJumpToLatestVisibilityChange={setShowJumpToLatest}
            onJumpToLatestHandlerChange={onJumpToLatestHandlerChange}
          />

          <div aria-hidden="true" style={{ height: `${composerClearancePx}px` }} />
        </div>

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
          floating={shouldFloatComposer}
        />
      </AppShell>
    </>
  );
}
