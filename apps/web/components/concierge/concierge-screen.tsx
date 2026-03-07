"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { UiRole } from "@/lib/types/chat-ui";
import { ChatThread } from "@/components/concierge/chat-thread";
import { MessageComposer } from "@/components/concierge/message-composer";
import { OperatorDrawer } from "@/components/concierge/operator-drawer";
import { useConciergeController } from "@/components/concierge/use-concierge-controller";
import { useVisualViewportInset } from "@/components/concierge/use-visual-viewport-inset";
import type { ConciergeVariant } from "@/components/concierge/types";
import { AppShell } from "@/components/ui/app-shell";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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

  if (variant === "concierge") {
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
            showReviewControls={false}
            canUseDebugTrace={controller.canUseDebugTrace}
            canUseReviewRoleControls={controller.canUseReviewRoleControls}
            canUseReviewControls={controller.canUseReviewControls}
            isRecommendationContext={controller.isRecommendationContext}
            operatorView={controller.operatorView}
            setOperatorView={controller.setOperatorView}
            onClose={() => controller.setOperatorOpen(false)}
            isLoading={controller.isLoading}
            onReviewAction={(action) => void controller.onReviewAction(action)}
            overrideMessage={controller.overrideMessage}
            setOverrideMessage={controller.setOverrideMessage}
            overrideRugIds={controller.overrideRugIds}
            setOverrideRugIds={controller.setOverrideRugIds}
            overrideNotes={controller.overrideNotes}
            setOverrideNotes={controller.setOverrideNotes}
            reviewState={controller.reviewState}
          />
        ) : null}
      </AppShell>
    );
  }

  return (
    <AppShell variant="workflow" className="pb-6">
      <PageHeader
        kicker="Trade Workflow"
        title="Trade Support"
        subtitle="Repeat-buyer workflow for designers and trade clients with context-driven personalization."
        variant="workflow"
        actions={
          <div className="flex flex-wrap items-end justify-end gap-2">
            {controller.roleSwitcherVisible ? (
              <label className="space-y-1">
                <span className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">Role</span>
                <select
                  value={controller.role}
                  onChange={(event) =>
                    void controller.onRoleChange(event.target.value as UiRole)
                  }
                  disabled={controller.isLoading}
                  className="h-11 rounded-md border border-input bg-background px-3 text-base"
                >
                  {controller.roleOptions.map((roleOption) => (
                    <option value={roleOption} key={roleOption}>
                      {roleOption}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <Badge variant="secondary">Role: {controller.role}</Badge>
            )}
            {controller.canOpenOperator ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => controller.setOperatorOpen(true)}
              >
                Operator
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              onClick={controller.onReset}
              disabled={controller.isLoading}
              className="h-11 px-4 text-base"
            >
              New Session
            </Button>
          </div>
        }
      />

      <div className="mx-auto w-full max-w-[860px] space-y-4">
        {controller.turns.length === 0 ? (
          <SectionCard title="Quick starts" className="border-border/60" tone="soft" density="compact">
            <div className="flex flex-wrap gap-2">
              {controller.starterPrompts.map((starter, index) => (
                <Button
                  key={starter}
                  type="button"
                  variant="outline"
                  size="sm"
                  className={cn(
                    "h-auto whitespace-normal py-2 text-left leading-6",
                    index > 1 ? "hidden sm:inline-flex" : ""
                  )}
                  onClick={() => controller.pushStarterPrompt(starter)}
                  disabled={controller.isLoading}
                >
                  {starter}
                </Button>
              ))}
            </div>
          </SectionCard>
        ) : null}

        <SectionCard
          title="Designer Context"
          description="Set project context once; it will be included in each turn."
          className="border-border/60"
          tone="soft"
        >
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="trade-tenant-id">Tenant ID</Label>
              <Input
                id="trade-tenant-id"
                value={controller.tradeContext.tenant_id}
                onChange={controller.onTradeContextField("tenant_id")}
                placeholder="optional"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="trade-client-id">Trade Client ID</Label>
              <Input
                id="trade-client-id"
                value={controller.tradeContext.trade_client_id}
                onChange={controller.onTradeContextField("trade_client_id")}
                placeholder="designer account id"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="project-name">Project Name</Label>
              <Input
                id="project-name"
                value={controller.tradeContext.project_name}
                onChange={controller.onTradeContextField("project_name")}
                placeholder="Lakeside Residence"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="active-room">Active Room</Label>
              <Input
                id="active-room"
                value={controller.tradeContext.active_room}
                onChange={controller.onTradeContextField("active_room")}
                placeholder="living room"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="preferred-style">Preferred Styles</Label>
              <Input
                id="preferred-style"
                value={controller.tradeContext.preferred_styles}
                onChange={controller.onTradeContextField("preferred_styles")}
                placeholder="Kazak, Oushak"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="preferred-palette">Preferred Palette</Label>
              <Input
                id="preferred-palette"
                value={controller.tradeContext.preferred_palette}
                onChange={controller.onTradeContextField("preferred_palette")}
                placeholder="earthy, muted blues"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="budget-max">Budget Max</Label>
              <Input
                id="budget-max"
                type="number"
                min="0"
                value={controller.tradeContext.budget_max}
                onChange={controller.onTradeContextField("budget_max")}
                placeholder="4000"
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="trade-notes">Notes</Label>
              <Textarea
                id="trade-notes"
                rows={2}
                value={controller.tradeContext.notes}
                onChange={controller.onTradeContextField("notes")}
                placeholder="Client avoids bright reds..."
              />
            </div>
          </div>
        </SectionCard>

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
          showReviewControls={true}
          canUseDebugTrace={controller.canUseDebugTrace}
          canUseReviewRoleControls={controller.canUseReviewRoleControls}
          canUseReviewControls={controller.canUseReviewControls}
          isRecommendationContext={controller.isRecommendationContext}
          operatorView={controller.operatorView}
          setOperatorView={controller.setOperatorView}
          onClose={() => controller.setOperatorOpen(false)}
          isLoading={controller.isLoading}
          onReviewAction={(action) => void controller.onReviewAction(action)}
          overrideMessage={controller.overrideMessage}
          setOverrideMessage={controller.setOverrideMessage}
          overrideRugIds={controller.overrideRugIds}
          setOverrideRugIds={controller.setOverrideRugIds}
          overrideNotes={controller.overrideNotes}
          setOverrideNotes={controller.setOverrideNotes}
          reviewState={controller.reviewState}
        />
      ) : null}
    </AppShell>
  );
}
