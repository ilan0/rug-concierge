"use client";

import type { UiRole } from "@/lib/types/chat-ui";
import { ChatThread } from "@/components/concierge/chat-thread";
import { MessageComposer } from "@/components/concierge/message-composer";
import { OperatorDrawer } from "@/components/concierge/operator-drawer";
import { useConciergeController } from "@/components/concierge/use-concierge-controller";
import { modeLabel } from "@/components/concierge/utils";
import type { ConciergeVariant } from "@/components/concierge/types";
import { AppShell } from "@/components/ui/app-shell";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";


type ConciergeScreenProps = {
  debug: boolean;
  variant?: ConciergeVariant;
  tenantId: string;
};

function formatConstraintSummary(input: {
  size?: { widthIn: number; lengthIn: number; toleranceIn?: number };
  budgetMax?: number;
  style?: string;
  palette?: string;
}) {
  const toFeetLabel = (inches: number): string => {
    const feet = Math.floor(inches / 12);
    const remainder = Math.round(inches - feet * 12);
    if (remainder === 0) return `${feet}'`;
    return `${feet}'${remainder}"`;
  };

  const items: string[] = [];
  if (input.size) {
    items.push(
      `Size ${toFeetLabel(input.size.widthIn)}×${toFeetLabel(input.size.lengthIn)}${
        typeof input.size.toleranceIn === "number" ? ` ±${input.size.toleranceIn}"` : ""
      }`
    );
  }
  if (typeof input.budgetMax === "number") {
    items.push(`Budget up to $${input.budgetMax.toLocaleString()}`);
  }
  if (input.style) {
    items.push(`Style ${input.style}`);
  }
  if (input.palette) {
    items.push(`Palette ${input.palette}`);
  }
  return items.slice(0, 4);
}

export function ConciergeScreen({
  debug,
  variant = "concierge",
  tenantId,
}: ConciergeScreenProps) {
  const controller = useConciergeController({ debug, variant, tenantId });
  const activeConstraintItems = controller.recommendationState
    ? formatConstraintSummary({
        size: controller.recommendationState.hard_constraints.size,
        budgetMax: controller.recommendationState.hard_constraints.budgetMax,
        style: controller.recommendationState.soft_preferences?.style,
        palette: controller.recommendationState.soft_preferences?.palette,
      })
    : [];

  return (
    <AppShell>
      <PageHeader
        kicker={variant === "trade" ? "Trade Workflow" : "Customer Flow"}
        title={variant === "trade" ? "Trade Support" : "Rug Concierge"}
        subtitle={
          variant === "trade"
            ? "Repeat-buyer workflow for designers and trade clients with context-driven personalization."
            : "Main customer-facing chat. The backend routes each turn to general chat or recommendation mode."
        }
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
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
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
              variant="secondary"
              onClick={controller.onReset}
              disabled={controller.isLoading}
            >
              New Session
            </Button>
          </div>
        }
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
        <section className="space-y-4">
          <SectionCard title="Quick Starts">
            <div className="flex flex-wrap gap-2">
              {controller.starterPrompts.map((starter) => (
                <Button
                  key={starter}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => controller.pushStarterPrompt(starter)}
                  disabled={controller.isLoading}
                >
                  {starter}
                </Button>
              ))}
            </div>
          </SectionCard>

          {variant === "trade" ? (
            <SectionCard
              title="Designer Context"
              description="Set project context once; it will be included in each turn."
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
          ) : null}

          {controller.recommendationState ? (
            <SectionCard title="Active Constraints">
              <div className="flex flex-wrap gap-2">
                {activeConstraintItems.length > 0 ? (
                  activeConstraintItems.map((item) => (
                    <Badge key={item} variant="outline">
                      {item}
                    </Badge>
                  ))
                ) : (
                  <Badge variant="outline">No hard constraints yet</Badge>
                )}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => void controller.onConstraintAction("clear_budget")}
                  disabled={controller.isLoading}
                >
                  Clear budget
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => void controller.onConstraintAction("clear_size")}
                  disabled={controller.isLoading}
                >
                  Clear size
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() =>
                    void controller.onConstraintAction("start_over_constraints")
                  }
                  disabled={controller.isLoading}
                >
                  Start over constraints
                </Button>
              </div>
            </SectionCard>
          ) : null}

          <ChatThread
            turns={controller.turns}
            isLoading={controller.isLoading}
            showSlowNotice={controller.showSlowNotice}
            onSelectTurn={controller.setSelectedTurnId}
          />

          <MessageComposer
            variant={variant}
            message={controller.message}
            isLoading={controller.isLoading}
            canSubmit={controller.canSubmit}
            error={controller.error}
            canRetry={Boolean(controller.lastFailedMessage)}
            onMessageChange={controller.setMessage}
            onSubmit={controller.onSubmit}
            onRetry={() => void controller.onRetryLastMessage()}
          />
        </section>

        <aside className="space-y-4">
          <SectionCard title="Session Context">
            <dl className="grid gap-3 text-sm">
              <div>
                <dt className="text-xs uppercase tracking-[0.08em] text-muted-foreground">Session ID</dt>
                <dd className="break-all">{controller.sessionId ?? "(new)"}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-[0.08em] text-muted-foreground">Tenant</dt>
                <dd>{controller.effectiveTenantId}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-[0.08em] text-muted-foreground">Role</dt>
                <dd>{controller.role}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-[0.08em] text-muted-foreground">Latest Mode</dt>
                <dd>{modeLabel(controller.latestAssistantMode) ?? "(none yet)"}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-[0.08em] text-muted-foreground">Total Turns</dt>
                <dd>{controller.turns.length}</dd>
              </div>
              {debug && controller.canUseDebugTrace ? (
                <div>
                  <dt className="text-xs uppercase tracking-[0.08em] text-muted-foreground">Debug Run</dt>
                  <dd className="break-all">{controller.debugRunId}</dd>
                </div>
              ) : null}
            </dl>
          </SectionCard>

          <SectionCard title={variant === "trade" ? "Trade Tips" : "Demo Tips"}>
            <ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground">
              {variant === "trade" ? (
                <>
                  <li>Set project and room first, then ask for option sets.</li>
                  <li>Use style and palette notes to personalize ranking.</li>
                  <li>Adjust budget in context for fast repeat requests.</li>
                </>
              ) : (
                <>
                  <li>Start broad, then narrow by size and budget.</li>
                  <li>Try trade role for designer-oriented responses.</li>
                  <li>Use inventory page to verify candidate transparency.</li>
                </>
              )}
            </ul>
          </SectionCard>
        </aside>
      </div>

      <OperatorDrawer
        open={controller.operatorOpen}
        selectedTurn={controller.selectedTurn}
        debug={debug}
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
    </AppShell>
  );
}
