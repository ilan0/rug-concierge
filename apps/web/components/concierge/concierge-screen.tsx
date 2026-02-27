"use client";

import type { UiRole } from "@/lib/types/chat-ui";
import { ChatThread } from "@/components/concierge/chat-thread";
import { MessageComposer } from "@/components/concierge/message-composer";
import { OperatorDrawer } from "@/components/concierge/operator-drawer";
import { useConciergeController } from "@/components/concierge/use-concierge-controller";
import { modeLabel } from "@/components/concierge/utils";
import type { ConciergeVariant } from "@/components/concierge/types";

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
        typeof input.size.toleranceIn === "number" ? ` \u00b1${input.size.toleranceIn}"` : ""
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
    <main className="ui-shell ui-showroom concierge-page concierge-showroom">
      <header className="ui-header concierge-header">
        <div>
          <p className="ui-kicker concierge-eyebrow">
            {variant === "trade" ? "Trade Workflow" : "Customer Flow"}
          </p>
          <h1>{variant === "trade" ? "Trade Support" : "Rug Concierge"}</h1>
          <p className="ui-subtitle concierge-subtitle">
            {variant === "trade"
              ? "Repeat-buyer workflow for designers and trade clients with context-driven personalization."
              : "Main customer-facing chat. The backend routes each turn to general chat or recommendation mode."}
          </p>
        </div>
        <div className="concierge-controls">
          {controller.roleSwitcherVisible ? (
            <label>
              Role
              <select
                value={controller.role}
                onChange={(event) =>
                  void controller.onRoleChange(event.target.value as UiRole)
                }
                disabled={controller.isLoading}
              >
                {controller.roleOptions.map((roleOption) => (
                  <option value={roleOption} key={roleOption}>
                    {roleOption}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p className="concierge-mode-chip">Role: {controller.role}</p>
          )}
          {controller.canOpenOperator ? (
            <button
              type="button"
              onClick={() => controller.setOperatorOpen(true)}
              className="concierge-operator-open-btn"
            >
              Operator
            </button>
          ) : null}
          <button
            type="button"
            onClick={controller.onReset}
            disabled={controller.isLoading}
          >
            New Session
          </button>
        </div>
      </header>

      <div className="concierge-layout">
        <section className="concierge-main">
          <section className="concierge-starters">
            <p>Quick starts</p>
            <div className="concierge-starter-row">
              {controller.starterPrompts.map((starter) => (
                <button
                  key={starter}
                  type="button"
                  onClick={() => controller.pushStarterPrompt(starter)}
                  disabled={controller.isLoading}
                >
                  {starter}
                </button>
              ))}
            </div>
          </section>

          {variant === "trade" ? (
            <section className="concierge-trade-context">
              <h3>Designer Context</h3>
              <p>
                Add trade/project context once. It is injected each turn for
                personalized responses.
              </p>
              <div className="concierge-trade-grid">
                <label>
                  Tenant ID
                  <input
                    value={controller.tradeContext.tenant_id}
                    onChange={controller.onTradeContextField("tenant_id")}
                    placeholder="optional"
                  />
                </label>
                <label>
                  Trade Client ID
                  <input
                    value={controller.tradeContext.trade_client_id}
                    onChange={controller.onTradeContextField("trade_client_id")}
                    placeholder="designer account id"
                  />
                </label>
                <label>
                  Project Name
                  <input
                    value={controller.tradeContext.project_name}
                    onChange={controller.onTradeContextField("project_name")}
                    placeholder="Lakeside Residence"
                  />
                </label>
                <label>
                  Active Room
                  <input
                    value={controller.tradeContext.active_room}
                    onChange={controller.onTradeContextField("active_room")}
                    placeholder="living room"
                  />
                </label>
                <label>
                  Preferred Styles
                  <input
                    value={controller.tradeContext.preferred_styles}
                    onChange={controller.onTradeContextField("preferred_styles")}
                    placeholder="Kazak, Oushak"
                  />
                </label>
                <label>
                  Preferred Palette
                  <input
                    value={controller.tradeContext.preferred_palette}
                    onChange={controller.onTradeContextField("preferred_palette")}
                    placeholder="earthy, muted blues"
                  />
                </label>
                <label>
                  Budget Max
                  <input
                    type="number"
                    min="0"
                    value={controller.tradeContext.budget_max}
                    onChange={controller.onTradeContextField("budget_max")}
                    placeholder="4000"
                  />
                </label>
                <label className="concierge-trade-notes">
                  Notes
                  <textarea
                    rows={2}
                    value={controller.tradeContext.notes}
                    onChange={controller.onTradeContextField("notes")}
                    placeholder="client avoids bright reds..."
                  />
                </label>
              </div>
            </section>
          ) : null}

          {controller.recommendationState ? (
            <section className="ui-card concierge-constraint-bar">
              <div>
                <p className="ui-kicker">Active Constraints</p>
                <div className="concierge-constraint-pills">
                  {activeConstraintItems.length > 0 ? (
                    activeConstraintItems.map((item) => (
                      <span key={item} className="ui-pill">
                        {item}
                      </span>
                    ))
                  ) : (
                    <span className="ui-pill">No hard constraints yet</span>
                  )}
                </div>
              </div>
              <div className="concierge-constraint-actions">
                <button
                  type="button"
                  className="ui-btn--ghost"
                  onClick={() => void controller.onConstraintAction("clear_budget")}
                  disabled={controller.isLoading}
                >
                  Clear budget
                </button>
                <button
                  type="button"
                  className="ui-btn--ghost"
                  onClick={() => void controller.onConstraintAction("clear_size")}
                  disabled={controller.isLoading}
                >
                  Clear size
                </button>
                <button
                  type="button"
                  className="ui-btn--ghost"
                  onClick={() =>
                    void controller.onConstraintAction("start_over_constraints")
                  }
                  disabled={controller.isLoading}
                >
                  Start over constraints
                </button>
              </div>
            </section>
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

        <aside className="concierge-side">
          <section className="concierge-panel">
            <h3>Session Context</h3>
            <dl>
              <div>
                <dt>Session ID</dt>
                <dd>{controller.sessionId ?? "(new)"}</dd>
              </div>
              <div>
                <dt>Tenant</dt>
                <dd>{controller.effectiveTenantId}</dd>
              </div>
              <div>
                <dt>Role</dt>
                <dd>{controller.role}</dd>
              </div>
              <div>
                <dt>Latest Mode</dt>
                <dd>{modeLabel(controller.latestAssistantMode) ?? "(none yet)"}</dd>
              </div>
              <div>
                <dt>Total Turns</dt>
                <dd>{controller.turns.length}</dd>
              </div>
              {debug && controller.canUseDebugTrace ? (
                <div>
                  <dt>Debug Run</dt>
                  <dd>{controller.debugRunId}</dd>
                </div>
              ) : null}
            </dl>
          </section>

          <section className="concierge-panel">
            <h3>{variant === "trade" ? "Trade Tips" : "Demo Tips"}</h3>
            <ul>
              {variant === "trade" ? (
                <>
                  <li>Set project + room first, then ask for multi-option sets.</li>
                  <li>Use style/palette notes to personalize ranking behavior.</li>
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
          </section>
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
    </main>
  );
}
