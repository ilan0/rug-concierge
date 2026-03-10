"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChatThread } from "@/components/concierge/chat-thread";
import { MessageComposer } from "@/components/concierge/message-composer";
import { OperatorDrawer } from "@/components/concierge/operator-drawer";
import { useConciergeController } from "@/components/concierge/use-concierge-controller";
import { useVisualViewportInset } from "@/components/concierge/use-visual-viewport-inset";
import type { ConciergeVariant } from "@/components/concierge/types";
import { AppShell } from "@/components/ui/app-shell";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ConciergeScreenProps = {
  debug: boolean;
  variant?: ConciergeVariant;
  tenantId: string;
};

const TITLE_SIZE = "text-[38px] leading-[1.08]";
const SUBTITLE_SIZE = "text-[20px] leading-[1.5]";
const BODY_SIZE = "text-[18px] leading-[1.65]";
const COMPOSER_REST_OFFSET_DESKTOP = 12;
const COMPOSER_REST_OFFSET_MOBILE = 8;
const CONTENT_SAFETY_GAP = 10;
const INITIAL_COMPOSER_HEIGHT = 92;
const SHORT_THREAD_MAX_TURNS = 2;

export function ConciergeScreen({
  debug,
  variant = "concierge",
  tenantId,
}: ConciergeScreenProps) {
  const controller = useConciergeController({ debug, variant, tenantId });
  const keyboardInsetPx = useVisualViewportInset();
  const [composerHeightPx, setComposerHeightPx] = useState(INITIAL_COMPOSER_HEIGHT);
  const [isSmallViewport, setIsSmallViewport] = useState(false);

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

  const composerRestOffsetPx = isSmallViewport
    ? COMPOSER_REST_OFFSET_MOBILE
    : COMPOSER_REST_OFFSET_DESKTOP;
  const composerClearancePx = useMemo(
    () =>
      Math.max(
        INITIAL_COMPOSER_HEIGHT + CONTENT_SAFETY_GAP,
        composerHeightPx +
          keyboardInsetPx +
          composerRestOffsetPx +
          CONTENT_SAFETY_GAP
      ),
    [composerHeightPx, keyboardInsetPx, composerRestOffsetPx]
  );
  const railStyle = useMemo(
    () => ({
      width:
        "min(820px, calc(100vw - env(safe-area-inset-left, 0px) - env(safe-area-inset-right, 0px) - 1.5rem))",
    }),
    []
  );
  const hasRecommendationTurn = useMemo(
    () =>
      controller.turns.some(
        (turn) =>
          turn.role === "assistant" &&
          Array.isArray(turn.recommendations) &&
          turn.recommendations.length > 0
      ),
    [controller.turns]
  );
  const isShortThreadStage =
    controller.turns.length <= SHORT_THREAD_MAX_TURNS &&
    !controller.isLoading &&
    !hasRecommendationTurn;

  return (
    <AppShell
      variant="conversational"
      className="relative min-h-[calc(100svh-2rem)] !min-h-[calc(100dvh-2rem)] pb-6 [text-size-adjust:100%] [-webkit-text-size-adjust:100%]"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(circle_at_12%_8%,rgba(255,241,218,0.55),transparent_40%),radial-gradient(circle_at_88%_12%,rgba(236,219,198,0.35),transparent_42%),linear-gradient(180deg,rgba(250,245,238,0.88),rgba(244,236,225,0.9))]"
      />

      <header
        className="mx-auto [text-size-adjust:100%] [-webkit-text-size-adjust:100%] pt-5 text-center"
        style={railStyle}
      >
        <div className="mb-2 flex min-h-7 items-center justify-end">
          {controller.isDeveloperRole ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 rounded-full px-2 text-[11px] text-muted-foreground"
              onClick={() => controller.setOperatorOpen(true)}
            >
              Debug
            </Button>
          ) : null}
        </div>

        <h1 className={cn("font-serif font-semibold tracking-tight text-foreground", TITLE_SIZE)}>
          Rug Concierge
        </h1>
        <p className={cn("mx-auto mt-3 max-w-2xl text-foreground/85", SUBTITLE_SIZE)}>
          Describe your room, size, budget, and style in plain words.
        </p>
      </header>

      <div
        className={cn(
          "mx-auto mt-4 [text-size-adjust:100%] [-webkit-text-size-adjust:100%]",
          isShortThreadStage && "min-h-[clamp(60px,12vh,120px)]"
        )}
        style={railStyle}
      >
        <ChatThread
          turns={controller.turns}
          isLoading={controller.isLoading}
          showSlowNotice={controller.showSlowNotice}
          jumpBottomOffsetPx={composerClearancePx}
          isDeveloperView={controller.isDeveloperRole}
          emptyStatePrompts={controller.starterPrompts.slice(0, 3)}
          bodyTextClassName={BODY_SIZE}
          onChoosePrompt={controller.pushStarterPrompt}
          onSelectTurn={controller.setSelectedTurnId}
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
      />

      {controller.canOpenOperator ? (
        <OperatorDrawer
          open={controller.operatorOpen}
          selectedTurn={controller.selectedTurn}
          debug={debug}
          canUseDebugTrace={controller.canUseDebugTrace}
          operatorView={controller.operatorView}
          setOperatorView={controller.setOperatorView}
          onClose={() => controller.setOperatorOpen(false)}
        />
      ) : null}
    </AppShell>
  );
}
