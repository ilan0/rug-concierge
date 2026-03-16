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
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";

type ConciergeScreenProps = {
  debug: boolean;
  variant?: ConciergeVariant;
  tenantId: string;
  storeName: string;
  storeLogoUrl: string | null;
};

const TITLE_SIZE = "text-[30px] leading-[1.08] md:text-[34px]";
const TITLE_SIZE_WITH_RECOMMENDATIONS = "text-[27px] leading-[1.07] md:text-[31px]";
const HERO_TITLE_SIZE = "text-[44px] leading-[1.05] sm:text-[52px] md:text-[60px]";
const SUBTITLE_SIZE = "text-[18px] leading-[1.45] sm:text-[20px] sm:leading-[1.5]";
const BODY_SIZE = "text-[18px] leading-[1.65]";
const COMPOSER_REST_OFFSET_DESKTOP = 12;
const COMPOSER_REST_OFFSET_MOBILE = 8;
const CONTENT_SAFETY_GAP = 10;
const INITIAL_COMPOSER_HEIGHT = 92;
const CONCIERGE_SUBTITLE =
  "Tell me the room, size, and style — I'll show you what's in the collection.";

export function ConciergeScreen({
  debug,
  variant = "concierge",
  tenantId,
  storeName,
  storeLogoUrl,
}: ConciergeScreenProps) {
  const controller = useConciergeController({ debug, variant, tenantId });
  const keyboardInsetPx = useVisualViewportInset();
  const [composerHeightPx, setComposerHeightPx] = useState(INITIAL_COMPOSER_HEIGHT);
  const [isSmallViewport, setIsSmallViewport] = useState(false);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [jumpToLatest, setJumpToLatest] = useState<(() => void) | null>(null);
  const [showStoreLogo, setShowStoreLogo] = useState(Boolean(storeLogoUrl));

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

  useEffect(() => {
    setShowStoreLogo(Boolean(storeLogoUrl));
  }, [storeLogoUrl]);

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
  const shouldFloatComposer = !(isHeroState && isSmallViewport);
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
  const isActivePreRecommendation = hasMessages && !hasRecommendationTurn;
  const isActiveWithRecommendation = hasRecommendationTurn;
  const showActiveDesktopSubtitle = isActivePreRecommendation;
  const showDesktopHeaderActions = controller.isDeveloperRole || hasMessages;
  const useIntroSpacer = isHeroState && !isSmallViewport;
  const emptyStatePromptLimit = isSmallViewport ? 2 : 3;

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
        className={cn(
          "mx-auto [text-size-adjust:100%] [-webkit-text-size-adjust:100%] text-center transition-[padding] duration-300",
          isHeroState
            ? "pb-6 pt-10 md:pb-8 md:pt-16"
            : isActiveWithRecommendation
              ? "pb-0 pt-0 md:pb-0.5 md:pt-0.5"
              : "pb-0.5 pt-0.5 md:pb-1 md:pt-1"
        )}
        style={railStyle}
      >
        {showDesktopHeaderActions ? (
          <div className="mb-1 hidden min-h-8 items-center justify-end gap-2 pr-4 md:flex">
            {controller.isDeveloperRole ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-8 rounded-full px-3 text-xs text-muted-foreground"
                onClick={() => controller.setOperatorOpen(true)}
              >
                Debug
              </Button>
            ) : null}
            {hasMessages ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-label="New Chat"
                className="h-8 rounded-full border border-border/45 bg-background/65 px-2 text-xs font-medium text-foreground/80 hover:border-primary/40 hover:bg-primary/10 hover:text-foreground lg:px-3"
                onClick={() => void controller.onNewChat()}
                disabled={controller.isLoading || controller.isResettingChat}
              >
                <Plus className="size-3.5 lg:mr-1" />
                <span className="hidden lg:inline">New Chat</span>
              </Button>
            ) : null}
          </div>
        ) : null}

        <div className="mx-auto max-w-4xl px-2 sm:px-4">
          {showStoreLogo && storeLogoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={storeLogoUrl}
              alt={`${storeName} logo`}
              className="mx-auto mb-2.5 h-12 w-auto object-contain sm:h-14 md:h-16"
              onError={() => setShowStoreLogo(false)}
            />
          ) : null}
          <h1
            className={cn(
              "mx-auto max-w-4xl text-pretty font-serif font-semibold tracking-tight text-foreground",
              isHeroState
                ? HERO_TITLE_SIZE
                : isActiveWithRecommendation
                  ? TITLE_SIZE_WITH_RECOMMENDATIONS
                  : TITLE_SIZE
            )}
          >
            {storeName}
          </h1>
        </div>
        {hasMessages ? (
          <div className="mt-1 flex justify-center md:hidden">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8 rounded-full border border-border/50 bg-background/70 px-3.5 text-xs font-medium text-foreground/85 hover:border-primary/40 hover:bg-primary/10 hover:text-foreground"
              onClick={() => void controller.onNewChat()}
              disabled={controller.isLoading || controller.isResettingChat}
            >
              <Plus className="mr-1 size-3.5" />
              New Chat
            </Button>
          </div>
        ) : null}
        <p
          className={cn(
            "mx-auto max-w-2xl transition-opacity duration-200",
            isHeroState
              ? cn("mt-3 text-foreground/85", SUBTITLE_SIZE)
              : showActiveDesktopSubtitle
                ? "mt-1 hidden text-sm leading-6 text-foreground/65 lg:block"
                : "hidden"
          )}
        >
          {CONCIERGE_SUBTITLE}
        </p>
      </header>

      <div
        className={cn(
          "mx-auto [text-size-adjust:100%] [-webkit-text-size-adjust:100%]",
          isHeroState ? "mt-4" : "mt-0",
          useIntroSpacer && "min-h-[clamp(44px,8vh,84px)]"
        )}
        style={railStyle}
      >
        <ChatThread
          turns={controller.turns}
          isLoading={controller.isLoading}
          showSlowNotice={controller.showSlowNotice}
          isDeveloperView={controller.isDeveloperRole}
          emptyStatePrompts={controller.starterPrompts.slice(0, emptyStatePromptLimit)}
          bodyTextClassName={BODY_SIZE}
          onChoosePrompt={controller.submitWithPrompt}
          onSelectTurn={controller.setSelectedTurnId}
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
