"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { AttractModePanel } from "@/components/concierge/attract-mode-panel";
import { ChatThread } from "@/components/concierge/chat-thread";
import { IdlePromptModal } from "@/components/concierge/idle-prompt-modal";
import { MessageComposer } from "@/components/concierge/message-composer";
import { StaffLockButton } from "@/components/concierge/staff-lock-button";
import { useConciergeController } from "@/components/concierge/use-concierge-controller";
import { useIdlePrompt } from "@/components/concierge/use-idle-prompt";
import { useVisualViewportInset } from "@/components/concierge/use-visual-viewport-inset";
import type { ConciergeVariant } from "@/components/concierge/types";
import { SiteHeader } from "@/components/ui/site-header";
import { cn } from "@/lib/utils";

type ConciergeScreenProps = {
  variant?: ConciergeVariant;
  tenantId: string;
  storeName: string;
  storeLogoUrl: string | null;
  attractImageUrls: string[];
};

const BODY_SIZE = "text-[18px] leading-7 sm:text-[19px] sm:leading-[30px]";
const COMPOSER_REST_OFFSET_DESKTOP = 12;
const COMPOSER_REST_OFFSET_MOBILE = 8;
const CONTENT_BOTTOM_PADDING_DESKTOP = 176;
const CONTENT_BOTTOM_PADDING_MOBILE = 164;

export function ConciergeScreen({
  variant = "concierge",
  tenantId,
  storeName,
  storeLogoUrl,
  attractImageUrls,
}: ConciergeScreenProps) {
  const controller = useConciergeController({ variant, tenantId });
  const hasMessages = controller.turns.length > 0;
  const idle = useIdlePrompt({ hasMessages });
  const keyboardInsetPx = useVisualViewportInset();
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

  const onComposerHeightChange = useCallback(() => {}, []);
  const onJumpToLatestHandlerChange = useCallback(
    (handler: (() => void) | null) => {
      setJumpToLatest(() => handler);
    },
    []
  );

  const shouldRenderActiveChat = idle.viewMode === "active_chat";
  const shouldShowHeader = shouldRenderActiveChat;

  const composerRestOffsetPx = isSmallViewport
    ? COMPOSER_REST_OFFSET_MOBILE
    : COMPOSER_REST_OFFSET_DESKTOP;

  const contentBottomPaddingPx = useMemo(
    () => (isSmallViewport ? CONTENT_BOTTOM_PADDING_MOBILE : CONTENT_BOTTOM_PADDING_DESKTOP) + keyboardInsetPx,
    [isSmallViewport, keyboardInsetPx]
  );

  const onStartOver = useCallback(() => {
    idle.registerActivity();
    idle.returnToAttractMode();
    controller.onReset();
    setShowJumpToLatest(false);
    setJumpToLatest(null);
  }, [controller, idle]);

  const onMessageChange = useCallback(
    (value: string) => {
      idle.registerActivity();
      controller.setMessage(value);
    },
    [controller, idle]
  );

  const onSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      idle.registerActivity();
      void controller.onSubmit(event);
    },
    [controller, idle]
  );

  const onChoosePrompt = useCallback(
    (prompt: (typeof controller.starterPrompts)[number]) => {
      idle.registerActivity();
      controller.submitWithPrompt(prompt);
    },
    [controller, idle]
  );

  return (
    <>
      {shouldShowHeader ? (
        <SiteHeader storeName={storeName} storeLogoUrl={storeLogoUrl} showBranding={true} />
      ) : null}
      <StaffLockButton />

      <div
        aria-hidden="true"
        className={cn(
          "pointer-events-none fixed inset-0 -z-10 transition-all duration-300",
          shouldRenderActiveChat
            ? "bg-[radial-gradient(circle_at_14%_8%,rgba(244,229,204,0.52),transparent_42%),radial-gradient(circle_at_88%_14%,rgba(219,196,164,0.24),transparent_44%),linear-gradient(180deg,#efe5d8_0%,#e6dac9_100%)] opacity-100"
            : "bg-[linear-gradient(180deg,rgba(43,32,22,0.24),rgba(43,32,22,0.32))] opacity-0"
        )}
      />

      <main
        className="relative [text-size-adjust:100%] [-webkit-text-size-adjust:100%]"
        style={{ minHeight: "100dvh", paddingTop: shouldShowHeader ? undefined : 0 }}
      >
        {idle.viewMode === "attract_mode" ? (
          <AttractModePanel
            storeName={storeName}
            storeLogoUrl={storeLogoUrl}
            backgroundImageUrls={attractImageUrls}
            onStart={idle.startActiveChat}
          />
        ) : (
          <div
            className="mx-auto w-[calc(100vw-24px)] max-w-[920px] pb-6 pt-14 [text-size-adjust:100%] [-webkit-text-size-adjust:100%] sm:w-[min(860px,calc(100vw-40px))] sm:pt-16 xl:w-[920px] concierge-bubble-enter"
            style={{ paddingBottom: `${contentBottomPaddingPx}px` }}
          >
            <ChatThread
              turns={controller.turns}
              isLoading={controller.isLoading}
              showSlowNotice={controller.showSlowNotice}
              emptyStatePrompts={controller.starterPrompts}
              bodyTextClassName={BODY_SIZE}
              onChoosePrompt={onChoosePrompt}
              onJumpToLatestVisibilityChange={setShowJumpToLatest}
              onJumpToLatestHandlerChange={onJumpToLatestHandlerChange}
            />

          </div>
        )}
      </main>

      {shouldRenderActiveChat ? (
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
          onMessageChange={onMessageChange}
          onSubmit={onSubmit}
          onRetry={() => void controller.onRetryLastMessage()}
          showJumpToLatest={showJumpToLatest}
          onJumpToLatest={jumpToLatest ?? undefined}
          floating={true}
          showNewChat={hasMessages && !controller.isLoading}
          isNewChatDisabled={controller.isLoading || controller.isResettingChat}
          onNewChat={onStartOver}
        />
      ) : null}

      <IdlePromptModal
        open={idle.showIdlePrompt}
        onContinue={idle.continueChat}
        onStartOver={onStartOver}
      />
    </>
  );
}
