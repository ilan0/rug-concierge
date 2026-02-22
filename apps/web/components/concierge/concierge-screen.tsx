"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  fetchChatDebugTrace,
  sendChatTurn,
} from "@/lib/concierge/client";
import { RecommendationCard } from "@/components/concierge/recommendation-card";
import type {
  UiChatResponseBody,
  UiRole,
  UiRecommendationItem,
} from "@/lib/types/chat-ui";
import { getUiRole, setUiRole, syncRoleCookie } from "@/lib/ui/role-session";

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

type ConciergeScreenProps = {
  debug: boolean;
};

const STARTER_PROMPTS = [
  "Show me what you have",
  "I need an 8x10 under $2500",
  "Show dining room options",
];

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

export function ConciergeScreen({ debug }: ConciergeScreenProps) {
  const [role, setRole] = useState<UiRole>("retail_customer");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedTurnId, setSelectedTurnId] = useState<string | null>(null);

  useEffect(() => {
    const storedRole = getUiRole();
    if (storedRole) setRole(storedRole);
  }, []);

  const debugRunId = useMemo(
    () =>
      toSlug(`concierge-debug-${new Date().toISOString().replace(/[:.]/g, "-")}`),
    []
  );

  const canSubmit = useMemo(
    () => message.trim().length > 0 && !isLoading,
    [message, isLoading]
  );

  const selectedTurn = turns.find((turn) => turn.id === selectedTurnId) ?? null;

  const pushStarterPrompt = (value: string) => {
    setMessage(value);
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
        {
          session_id: sessionId ?? undefined,
          role,
          message: userMessage,
        },
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
      if (debug) {
        setSelectedTurnId(assistantTurn.id);
      }
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
  };

  const latestAssistantMode = [...turns]
    .reverse()
    .find((turn) => turn.role === "assistant")?.responseMode;

  return (
    <main className="ui-shell ui-showroom concierge-page concierge-showroom">
      <header className="ui-header concierge-header">
        <div>
          <p className="ui-kicker concierge-eyebrow">Customer Flow</p>
          <h1>Rug Concierge</h1>
          <p className="ui-subtitle concierge-subtitle">
            Main customer-facing chat. The backend routes each turn to general
            chat, recommendations, or appraisal mode.
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
              <option value="retail_customer">retail_customer</option>
              <option value="trade_client">trade_client</option>
              <option value="store_staff">store_staff</option>
            </select>
          </label>
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
              {STARTER_PROMPTS.map((starter) => (
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
                  onClick={() => debug && setSelectedTurnId(turn.id)}
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
                placeholder="Type your rug request..."
                rows={3}
                maxLength={2000}
                disabled={isLoading}
              />
              <div className="concierge-form-actions">
                <span className="concierge-hint">
                  Enter to send, Shift+Enter for new line
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
            <h3>Demo Tips</h3>
            <ul>
              <li>Start broad, then narrow by size and budget.</li>
              <li>Try trade role for designer-oriented responses.</li>
              <li>Use inventory page to verify candidate transparency.</li>
            </ul>
          </section>

          {debug ? (
            <section className="concierge-panel concierge-trace-panel">
              <h3>Debug Trace</h3>
              {!selectedTurn || selectedTurn.role !== "assistant" ? (
                <p>Select an assistant turn to inspect trace data.</p>
              ) : selectedTurn.debug?.traceError ? (
                <p>{selectedTurn.debug.traceError}</p>
              ) : selectedTurn.debug?.trace ? (
                <>
                  <p className="concierge-trace-meta">
                    Case: {selectedTurn.debug.caseId}
                  </p>
                  <details open>
                    <summary>Route + Session State Snapshot</summary>
                    <pre>
                      {JSON.stringify(
                        (
                          selectedTurn.debug.trace.routeTrace as {
                            state_snapshot?: unknown;
                            routing?: unknown;
                          } | null
                        )?.state_snapshot ?? null,
                        null,
                        2
                      )}
                    </pre>
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
                  </details>
                  <details>
                    <summary>Recommendation Pipeline Metrics</summary>
                    <pre>
                      {JSON.stringify(
                        (
                          selectedTurn.debug.trace.pipelineTrace as {
                            candidate_counts?: unknown;
                            query_trace?: unknown;
                            timing_ms?: unknown;
                          } | null
                        ) ?? null,
                        null,
                        2
                      )}
                    </pre>
                  </details>
                  <details>
                    <summary>AI Request + Response</summary>
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
                  </details>
                </>
              ) : (
                <p>No trace found for selected turn.</p>
              )}
            </section>
          ) : null}
        </aside>
      </div>
    </main>
  );
}
