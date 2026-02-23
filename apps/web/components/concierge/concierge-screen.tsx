"use client";

import {
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import {
  fetchChatDebugTrace,
  sendChatTurn,
} from "@/lib/concierge/client";
import { RecommendationCard } from "@/components/concierge/recommendation-card";
import type {
  UiChatRequest,
  UiChatResponseBody,
  UiRole,
  UiRecommendationItem,
} from "@/lib/types/chat-ui";
import { getUiRole, setUiRole, syncRoleCookie } from "@/lib/ui/role-session";
import { UI_ROLES } from "@/lib/ui/roles";
import {
  DEFAULT_TRADE_SUPPORT_CONTEXT,
  type TradeSupportDraftContext,
} from "@/lib/types/trade-ui";
import { canRoleUseReviewControls } from "@/lib/auth/policy";

type DebugTraceSummary = {
  routeTrace: unknown | null;
  pipelineTrace: unknown | null;
};

type DebugMeta = {
  runId: string;
  caseId: string;
  routeTraceId: string | null;
  trace: DebugTraceSummary | null;
  traceError: string | null;
};

type Turn = {
  id: string;
  role: "user" | "assistant";
  text: string;
  responseMode?: UiChatResponseBody["mode"];
  recommendations?: UiRecommendationItem[];
  questions?: string[];
  createdAt: string;
  debug?: DebugMeta | null;
};

type UiReviewState = NonNullable<UiChatResponseBody["review_state"]>;
type OperatorView = "debug" | "review";

type ConciergeScreenProps = {
  debug: boolean;
  variant?: "concierge" | "trade";
};

const STARTER_PROMPTS_CONCIERGE = [
  "Show me what you have",
  "I need an 8x10 under $2500",
  "Show dining room options",
];

const STARTER_PROMPTS_TRADE = [
  "Need three options for a living room project under $4,000 each",
  "Show me neutral styles for a designer client mood board",
  "Find rugs that layer well with modern furniture",
];

function toRoomId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function modeLabel(mode: UiChatResponseBody["mode"] | undefined): string | null {
  if (!mode) return null;
  if (mode === "recommendation") return "recommendations";
  if (mode === "general_chat") return "general chat";
  if (mode === "appraisal") return "appraisal";
  return mode;
}

function toSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function summarizeTracePayload(payload: unknown): DebugTraceSummary {
  if (!payload || typeof payload !== "object") {
    return { routeTrace: null, pipelineTrace: null };
  }

  const data = payload as {
    traces?: Array<{ channel?: string | null; payload?: unknown }>;
  };
  if (!Array.isArray(data.traces)) {
    return { routeTrace: null, pipelineTrace: null };
  }

  const routeTrace =
    data.traces.find((trace) => trace?.channel === "chat-route")?.payload ?? null;
  const pipelineTrace =
    data.traces.find((trace) => trace?.channel === "recommendation-pipeline")
      ?.payload ?? null;

  return { routeTrace, pipelineTrace };
}

export function ConciergeScreen({
  debug,
  variant = "concierge",
}: ConciergeScreenProps) {
  const [role, setRole] = useState<UiRole>(
    variant === "trade" ? "trade_client" : "retail_customer"
  );
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedTurnId, setSelectedTurnId] = useState<string | null>(null);
  const [reviewState, setReviewState] = useState<UiReviewState | null>(null);
  const [operatorOpen, setOperatorOpen] = useState(false);
  const [operatorView, setOperatorView] = useState<OperatorView>("review");
  const [overrideMessage, setOverrideMessage] = useState("");
  const [overrideRugIds, setOverrideRugIds] = useState("");
  const [overrideNotes, setOverrideNotes] = useState("");
  const [tradeContext, setTradeContext] = useState<TradeSupportDraftContext>(
    DEFAULT_TRADE_SUPPORT_CONTEXT
  );

  useEffect(() => {
    const storedRole = getUiRole();
    if (!storedRole) return;
    if (variant === "trade") {
      if (
        storedRole === "trade_client" ||
        storedRole === "store_staff" ||
        storedRole === "developer"
      ) {
        setRole(storedRole);
      }
      return;
    }
    setRole(storedRole);
  }, [variant]);

  const debugRunId = useMemo(
    () =>
      toSlug(`concierge-debug-${new Date().toISOString().replace(/[:.]/g, "-")}`),
    []
  );

  const canSubmit = useMemo(
    () => message.trim().length > 0 && !isLoading,
    [message, isLoading]
  );

  const starterPrompts = useMemo(
    () =>
      variant === "trade" ? STARTER_PROMPTS_TRADE : STARTER_PROMPTS_CONCIERGE,
    [variant]
  );
  const roleOptions = useMemo(
    () =>
      variant === "trade"
        ? UI_ROLES.filter(
            (candidate) =>
              candidate === "trade_client" ||
              candidate === "store_staff" ||
              candidate === "developer"
          )
        : UI_ROLES,
    [variant]
  );

  const selectedTurn = turns.find((turn) => turn.id === selectedTurnId) ?? null;

  const pushStarterPrompt = (value: string) => {
    setMessage(value);
  };

  const onTradeContextField =
    (field: keyof TradeSupportDraftContext) =>
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      setTradeContext((prev) => ({
        ...prev,
        [field]: event.target.value,
      }));
    };

  const onRoleChange = async (nextRole: UiRole) => {
    setRole(nextRole);
    setUiRole(nextRole);
    try {
      await syncRoleCookie(nextRole);
    } catch {
      // Keep chat usable even if cookie sync fails.
    }
  };

  function buildChatRequestPayload(
    userMessage: string,
    activeRole: UiRole
  ): UiChatRequest {
    const payload: UiChatRequest = {
      session_id: sessionId ?? undefined,
      role: activeRole,
      message: userMessage,
    };

    if (variant !== "trade") {
      return payload;
    }

    if (tradeContext.tenant_id.trim()) {
      payload.tenant_id = tradeContext.tenant_id.trim();
    }
    if (tradeContext.trade_client_id.trim()) {
      payload.trade_client_id = tradeContext.trade_client_id.trim();
    }

    const preferences: Record<string, unknown> = {};
    if (tradeContext.preferred_styles.trim()) {
      preferences.preferred_styles = tradeContext.preferred_styles
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    }
    if (tradeContext.preferred_palette.trim()) {
      preferences.preferred_palette = tradeContext.preferred_palette
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    }
    if (tradeContext.notes.trim()) {
      preferences.notes = tradeContext.notes.trim();
    }
    if (Object.keys(preferences).length > 0) {
      payload.trade_preferences = preferences;
    }

    const budgetMax = Number(tradeContext.budget_max.trim());
    if (
      tradeContext.budget_max.trim() &&
      Number.isFinite(budgetMax) &&
      budgetMax >= 0
    ) {
      payload.constraints = {
        budgetMax,
      };
    }

    const roomId = toRoomId(tradeContext.active_room);
    if (tradeContext.project_name.trim() || roomId) {
      payload.project_context = {
        name: tradeContext.project_name.trim() || null,
        active_room_id: roomId || null,
      };
    }

    return payload;
  }

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const userMessage = message.trim();
    if (!userMessage) return;

    setError(null);
    setIsLoading(true);
    setMessage("");

    const debugCaseId = debug
      ? toSlug(`turn-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`)
      : null;

    const userTurn: Turn = {
      id: crypto.randomUUID(),
      role: "user",
      text: userMessage,
      createdAt: new Date().toISOString(),
    };
    setTurns((prev) => [...prev, userTurn]);

    try {
      const { payload, headers } = await sendChatTurn(
        buildChatRequestPayload(userMessage, role),
        debug && debugCaseId
          ? {
              debugTrace: {
                runId: debugRunId,
                caseId: debugCaseId,
              },
            }
          : undefined
      );

      setSessionId(payload.session_id);

      let debugMeta: DebugMeta | null = null;
      if (debug && debugCaseId) {
        try {
          const tracePayload = await fetchChatDebugTrace(debugRunId, debugCaseId);
          debugMeta = {
            runId: debugRunId,
            caseId: debugCaseId,
            routeTraceId: headers.chatRouteTraceId,
            trace: summarizeTracePayload(tracePayload),
            traceError: null,
          };
        } catch (traceError) {
          debugMeta = {
            runId: debugRunId,
            caseId: debugCaseId,
            routeTraceId: headers.chatRouteTraceId,
            trace: null,
            traceError:
              traceError instanceof Error
                ? traceError.message
                : "Failed to load trace payload.",
          };
        }
      }

      const response = payload.response;
      setReviewState(payload.review_state ?? null);
      const assistantTurn: Turn = {
        id: crypto.randomUUID(),
        role: "assistant",
        text: response.assistant_message,
        responseMode: payload.mode,
        recommendations:
          "recommendations" in response ? response.recommendations : undefined,
        questions: "questions" in response ? response.questions : undefined,
        createdAt: new Date().toISOString(),
        debug: debugMeta,
      };

      setTurns((prev) => [...prev, assistantTurn]);
      setSelectedTurnId(assistantTurn.id);
    } catch (nextError) {
      const details =
        nextError instanceof Error
          ? nextError.message
          : "Failed to send message.";
      setError(details);
    } finally {
      setIsLoading(false);
    }
  };

  const onReset = () => {
    setSessionId(null);
    setTurns([]);
    setMessage("");
    setError(null);
    setSelectedTurnId(null);
    setReviewState(null);
    setOverrideMessage("");
    setOverrideRugIds("");
    setOverrideNotes("");
    if (variant === "trade") {
      setTradeContext(DEFAULT_TRADE_SUPPORT_CONTEXT);
    }
  };

  const latestAssistantMode = [...turns]
    .reverse()
    .find((turn) => turn.role === "assistant")?.responseMode;

  const canUseReviewControls = canRoleUseReviewControls(role) && Boolean(sessionId);

  const onReviewAction = async (
    action: "approve" | "reject" | "regenerate" | "override"
  ) => {
    if (!sessionId) return;
    if (action === "override" && !overrideMessage.trim() && !overrideRugIds.trim()) {
      setError("Override needs a custom message or selected rug IDs.");
      return;
    }

    setError(null);
    setIsLoading(true);

    const userText =
      action === "approve"
        ? "Review action: approve recommendation set."
        : action === "reject"
          ? "Review action: reject recommendation set."
          : action === "regenerate"
            ? "Review action: regenerate recommendation set."
            : "Review action: override recommendation set.";

    setTurns((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        role: "user",
        text: userText,
        createdAt: new Date().toISOString(),
      },
    ]);

    const debugCaseId = debug
      ? toSlug(`turn-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`)
      : null;

    const overrideIds = overrideRugIds
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);

    const payload: UiChatRequest = {
      session_id: sessionId,
      role,
      message: "",
      review_action: action,
      ...(action === "override"
        ? {
            override: {
              assistant_message: overrideMessage.trim() || undefined,
              selected_rug_ids: overrideIds.length > 0 ? overrideIds : undefined,
              notes: overrideNotes.trim() || undefined,
            },
          }
        : {}),
    };

    try {
      const { payload: responsePayload, headers } = await sendChatTurn(
        payload,
        debug && debugCaseId
          ? {
              debugTrace: {
                runId: debugRunId,
                caseId: debugCaseId,
              },
            }
          : undefined
      );

      setSessionId(responsePayload.session_id);
      setReviewState(responsePayload.review_state ?? null);

      let debugMeta: DebugMeta | null = null;
      if (debug && debugCaseId) {
        try {
          const tracePayload = await fetchChatDebugTrace(debugRunId, debugCaseId);
          debugMeta = {
            runId: debugRunId,
            caseId: debugCaseId,
            routeTraceId: headers.chatRouteTraceId,
            trace: summarizeTracePayload(tracePayload),
            traceError: null,
          };
        } catch (traceError) {
          debugMeta = {
            runId: debugRunId,
            caseId: debugCaseId,
            routeTraceId: headers.chatRouteTraceId,
            trace: null,
            traceError:
              traceError instanceof Error
                ? traceError.message
                : "Failed to load trace payload.",
          };
        }
      }

      const assistant = responsePayload.response;
      const assistantTurn: Turn = {
        id: crypto.randomUUID(),
        role: "assistant",
        text: assistant.assistant_message,
        responseMode: responsePayload.mode,
        recommendations:
          "recommendations" in assistant ? assistant.recommendations : undefined,
        questions: "questions" in assistant ? assistant.questions : undefined,
        createdAt: new Date().toISOString(),
        debug: debugMeta,
      };
      setTurns((prev) => [
        ...prev,
        assistantTurn,
      ]);
      setSelectedTurnId(assistantTurn.id);

      if (action === "override") {
        setOverrideMessage("");
        setOverrideRugIds("");
        setOverrideNotes("");
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Review action failed.");
    } finally {
      setIsLoading(false);
    }
  };

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
              : "Main customer-facing chat. The backend routes each turn to general chat, recommendations, or appraisal mode."}
          </p>
        </div>
        <div className="concierge-controls">
          <label>
            Role
            <select
              value={role}
              onChange={(event) => void onRoleChange(event.target.value as UiRole)}
              disabled={isLoading}
            >
              {roleOptions.map((roleOption) => (
                <option value={roleOption} key={roleOption}>
                  {roleOption}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => setOperatorOpen(true)}
            className="concierge-operator-open-btn"
          >
            Operator
          </button>
          <button type="button" onClick={onReset} disabled={isLoading}>
            New Session
          </button>
        </div>
      </header>

      <div className="concierge-layout">
        <section className="concierge-main">
          <section className="concierge-starters">
            <p>Quick starts</p>
            <div className="concierge-starter-row">
              {starterPrompts.map((starter) => (
                <button
                  key={starter}
                  type="button"
                  onClick={() => pushStarterPrompt(starter)}
                  disabled={isLoading}
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
                    value={tradeContext.tenant_id}
                    onChange={onTradeContextField("tenant_id")}
                    placeholder="optional"
                  />
                </label>
                <label>
                  Trade Client ID
                  <input
                    value={tradeContext.trade_client_id}
                    onChange={onTradeContextField("trade_client_id")}
                    placeholder="designer account id"
                  />
                </label>
                <label>
                  Project Name
                  <input
                    value={tradeContext.project_name}
                    onChange={onTradeContextField("project_name")}
                    placeholder="Lakeside Residence"
                  />
                </label>
                <label>
                  Active Room
                  <input
                    value={tradeContext.active_room}
                    onChange={onTradeContextField("active_room")}
                    placeholder="living room"
                  />
                </label>
                <label>
                  Preferred Styles
                  <input
                    value={tradeContext.preferred_styles}
                    onChange={onTradeContextField("preferred_styles")}
                    placeholder="Kazak, Oushak"
                  />
                </label>
                <label>
                  Preferred Palette
                  <input
                    value={tradeContext.preferred_palette}
                    onChange={onTradeContextField("preferred_palette")}
                    placeholder="earthy, muted blues"
                  />
                </label>
                <label>
                  Budget Max
                  <input
                    type="number"
                    min="0"
                    value={tradeContext.budget_max}
                    onChange={onTradeContextField("budget_max")}
                    placeholder="4000"
                  />
                </label>
                <label className="concierge-trade-notes">
                  Notes
                  <textarea
                    rows={2}
                    value={tradeContext.notes}
                    onChange={onTradeContextField("notes")}
                    placeholder="client avoids bright reds..."
                  />
                </label>
              </div>
            </section>
          ) : null}

          <section className="concierge-thread">
            {turns.length === 0 ? (
              <div className="concierge-empty">
                Ask naturally: “show me 8x10 rugs under $2500” or “tell me about
                rug care.”
              </div>
            ) : (
              turns.map((turn) => (
                <article
                  key={turn.id}
                  className={
                    turn.role === "user"
                      ? "concierge-turn concierge-turn-user"
                      : "concierge-turn concierge-turn-assistant"
                  }
                  onClick={() =>
                    turn.role === "assistant" ? setSelectedTurnId(turn.id) : undefined
                  }
                >
                  <div className="concierge-turn-top">
                    <p className="concierge-turn-role">{turn.role}</p>
                    <time>{formatTime(turn.createdAt)}</time>
                  </div>
                  {turn.role === "assistant" && turn.responseMode ? (
                    <p className="concierge-mode-chip">
                      {modeLabel(turn.responseMode)}
                    </p>
                  ) : null}
                  <p>{turn.text}</p>

                  {turn.role === "assistant" &&
                  turn.questions &&
                  turn.questions.length > 0 ? (
                    <div className="concierge-question-block">
                      <strong>Clarifying Questions</strong>
                      <ul>
                        {turn.questions.map((question) => (
                          <li key={question}>{question}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {turn.role === "assistant" &&
                  turn.recommendations &&
                  turn.recommendations.length > 0 ? (
                    <div className="concierge-rec-grid">
                      {turn.recommendations.map((item) => (
                        <RecommendationCard item={item} key={item.rug_id} />
                      ))}
                    </div>
                  ) : null}
                </article>
              ))
            )}

            {isLoading ? (
              <article className="concierge-turn concierge-turn-assistant concierge-loading">
                <div className="concierge-loading-bar" />
                <div className="concierge-loading-bar short" />
              </article>
            ) : null}
          </section>

          <section className="concierge-input-wrap">
            <form onSubmit={onSubmit} className="concierge-form">
              <textarea
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder={
                  variant === "trade"
                    ? "Type a trade/design request..."
                    : "Type your rug request..."
                }
                rows={3}
                maxLength={2000}
                disabled={isLoading}
              />
              <div className="concierge-form-actions">
                <span className="concierge-hint">
                  {variant === "trade"
                    ? "Trade context is included with each message."
                    : "Enter to send, Shift+Enter for new line"}
                </span>
                <button type="submit" disabled={!canSubmit}>
                  {isLoading ? "Sending..." : "Send"}
                </button>
              </div>
            </form>
            {error ? <p className="concierge-error">{error}</p> : null}
          </section>
        </section>

        <aside className="concierge-side">
          <section className="concierge-panel">
            <h3>Session Context</h3>
            <dl>
              <div>
                <dt>Session ID</dt>
                <dd>{sessionId ?? "(new)"}</dd>
              </div>
              <div>
                <dt>Role</dt>
                <dd>{role}</dd>
              </div>
              <div>
                <dt>Latest Mode</dt>
                <dd>{modeLabel(latestAssistantMode) ?? "(none yet)"}</dd>
              </div>
              <div>
                <dt>Total Turns</dt>
                <dd>{turns.length}</dd>
              </div>
              {debug ? (
                <div>
                  <dt>Debug Run</dt>
                  <dd>{debugRunId}</dd>
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

      {operatorOpen ? (
        <>
          <button
            type="button"
            aria-label="Close operator drawer"
            className="concierge-operator-backdrop"
            onClick={() => setOperatorOpen(false)}
          />
          <aside className="concierge-operator-drawer">
            <div className="concierge-operator-drawer-head">
              <div>
                <p className="concierge-mode-chip">
                  {selectedTurn?.responseMode
                    ? modeLabel(selectedTurn.responseMode)
                    : "no turn selected"}
                </p>
                <h3>Operator</h3>
                <p>
                  {selectedTurn
                    ? `Selected turn at ${formatTime(selectedTurn.createdAt)}`
                    : "Select an assistant turn to inspect or review."}
                </p>
              </div>
              <button type="button" onClick={() => setOperatorOpen(false)}>
                Close
              </button>
            </div>

            <div className="concierge-operator-view-toggle">
              <button
                type="button"
                className={operatorView === "review" ? "active" : ""}
                onClick={() => setOperatorView("review")}
              >
                Review
              </button>
              <button
                type="button"
                className={operatorView === "debug" ? "active" : ""}
                onClick={() => setOperatorView("debug")}
              >
                Debug
              </button>
            </div>

            {operatorView === "review" ? (
              <div className="concierge-operator-drawer-body">
                <section className="concierge-panel">
                  <h3>Review Controls</h3>
                  {!canUseReviewControls ? (
                    <p>
                      Review controls are available only for{" "}
                      <code>store_staff</code> or <code>developer</code>.
                    </p>
                  ) : (
                    <>
                      <div className="concierge-starter-row">
                        <button
                          type="button"
                          onClick={() => void onReviewAction("approve")}
                          disabled={isLoading}
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          onClick={() => void onReviewAction("reject")}
                          disabled={isLoading}
                        >
                          Reject
                        </button>
                        <button
                          type="button"
                          onClick={() => void onReviewAction("regenerate")}
                          disabled={isLoading}
                        >
                          Regenerate
                        </button>
                      </div>
                      <label>
                        Override Message
                        <textarea
                          rows={2}
                          value={overrideMessage}
                          onChange={(event) => setOverrideMessage(event.target.value)}
                          placeholder="Store-staff final wording..."
                        />
                      </label>
                      <label>
                        Override Rug IDs (comma-separated)
                        <input
                          value={overrideRugIds}
                          onChange={(event) => setOverrideRugIds(event.target.value)}
                          placeholder="id1,id2,id3"
                        />
                      </label>
                      <label>
                        Override Notes
                        <input
                          value={overrideNotes}
                          onChange={(event) => setOverrideNotes(event.target.value)}
                          placeholder="why override was needed"
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => void onReviewAction("override")}
                        disabled={isLoading}
                      >
                        Apply Override
                      </button>
                    </>
                  )}
                </section>
                <section className="concierge-panel">
                  <h3>Review State</h3>
                  <pre>{JSON.stringify(reviewState, null, 2)}</pre>
                </section>
              </div>
            ) : null}

            {operatorView === "debug" ? (
              <div className="concierge-operator-drawer-body concierge-trace-panel">
                {!debug ? (
                  <section className="concierge-panel">
                    <h3>Debug Disabled</h3>
                    <p>Enable debug mode (<code>?debug=1</code>) before sending turns.</p>
                  </section>
                ) : !selectedTurn || selectedTurn.role !== "assistant" ? (
                  <section className="concierge-panel">
                    <h3>No Turn Selected</h3>
                    <p>Select an assistant turn from the thread.</p>
                  </section>
                ) : selectedTurn.debug?.traceError ? (
                  <section className="concierge-panel">
                    <h3>Trace Error</h3>
                    <p>{selectedTurn.debug.traceError}</p>
                  </section>
                ) : selectedTurn.debug?.trace ? (
                  <>
                    <section className="concierge-panel">
                      <h3>Routing + Decision</h3>
                      <pre>
                        {JSON.stringify(
                          (
                            selectedTurn.debug.trace.routeTrace as {
                              routing?: unknown;
                            } | null
                          )?.routing ?? null,
                          null,
                          2
                        )}
                      </pre>
                    </section>
                    <section className="concierge-panel">
                      <h3>Pipeline Metrics</h3>
                      <pre>
                        {JSON.stringify(
                          (
                            selectedTurn.debug.trace.pipelineTrace as {
                              candidate_counts?: unknown;
                              timing_ms?: unknown;
                              query_trace?: unknown;
                            } | null
                          ) ?? null,
                          null,
                          2
                        )}
                      </pre>
                    </section>
                    <section className="concierge-panel">
                      <h3>AI Request + Response</h3>
                      <pre>
                        {JSON.stringify(
                          (
                            selectedTurn.debug.trace.pipelineTrace as {
                              ai_trace?: unknown;
                            } | null
                          )?.ai_trace ?? null,
                          null,
                          2
                        )}
                      </pre>
                    </section>
                    <section className="concierge-panel">
                      <h3>Session Snapshot</h3>
                      <pre>
                        {JSON.stringify(
                          (
                            selectedTurn.debug.trace.routeTrace as {
                              state_snapshot?: unknown;
                            } | null
                          )?.state_snapshot ?? null,
                          null,
                          2
                        )}
                      </pre>
                    </section>
                  </>
                ) : (
                  <section className="concierge-panel">
                    <h3>No Trace Found</h3>
                    <p>
                      Debug must be enabled before sending the turn to capture traces.
                    </p>
                  </section>
                )}
              </div>
            ) : null}
          </aside>
        </>
      ) : null}
    </main>
  );
}
