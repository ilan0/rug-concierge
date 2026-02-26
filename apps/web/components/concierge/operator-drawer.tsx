import type { Turn, OperatorView, UiReviewState } from "@/components/concierge/types";
import { formatTime, modeLabel } from "@/components/concierge/utils";

type OperatorDrawerProps = {
  open: boolean;
  selectedTurn: Turn | null;
  debug: boolean;
  canUseDebugTrace: boolean;
  canUseReviewRoleControls: boolean;
  canUseReviewControls: boolean;
  isRecommendationContext: boolean;
  operatorView: OperatorView;
  setOperatorView: (view: OperatorView) => void;
  onClose: () => void;
  isLoading: boolean;
  onReviewAction: (action: "approve" | "reject" | "regenerate" | "override") => void;
  overrideMessage: string;
  setOverrideMessage: (value: string) => void;
  overrideRugIds: string;
  setOverrideRugIds: (value: string) => void;
  overrideNotes: string;
  setOverrideNotes: (value: string) => void;
  reviewState: UiReviewState | null;
};

export function OperatorDrawer(input: OperatorDrawerProps) {
  if (!input.open) return null;

  const routeTrace =
    (input.selectedTurn?.debug?.trace?.routeTrace as {
      routing?: unknown;
      state_snapshot?: unknown;
      ai_context_packet_stats?: unknown;
      timing_ms?: unknown;
    } | null) ?? null;
  const pipelineTrace =
    (input.selectedTurn?.debug?.trace?.pipelineTrace as {
      ai_trace?: unknown;
      candidate_counts?: unknown;
      timing_ms?: unknown;
      query_trace?: unknown;
    } | null) ?? null;
  const generalChatTrace =
    (input.selectedTurn?.debug?.trace?.generalChatTrace as {
      ai_trace?: unknown;
      context_packet_stats?: unknown;
      timing_ms?: unknown;
    } | null) ?? null;
  const unifiedAiTrace = pipelineTrace?.ai_trace ?? generalChatTrace?.ai_trace ?? null;
  const unifiedMetrics = pipelineTrace
    ? {
        candidate_counts: pipelineTrace.candidate_counts ?? null,
        query_trace: pipelineTrace.query_trace ?? null,
        timing_ms: pipelineTrace.timing_ms ?? null,
      }
    : generalChatTrace
      ? {
          context_packet_stats: generalChatTrace.context_packet_stats ?? null,
          timing_ms: generalChatTrace.timing_ms ?? null,
        }
      : {
          context_packet_stats: routeTrace?.ai_context_packet_stats ?? null,
          timing_ms: routeTrace?.timing_ms ?? null,
        };

  return (
    <>
      <button
        type="button"
        aria-label="Close operator drawer"
        className="concierge-operator-backdrop"
        onClick={input.onClose}
      />
      <aside className="concierge-operator-drawer">
        <div className="concierge-operator-drawer-head">
          <div>
            <p className="concierge-mode-chip">
              {input.selectedTurn?.fineMode
                ? modeLabel(input.selectedTurn.fineMode)
                : "no turn selected"}
            </p>
            <h3>Operator</h3>
            <p>
              {input.selectedTurn
                ? `Selected turn at ${formatTime(input.selectedTurn.createdAt)}`
                : "Select an assistant turn to inspect or review."}
            </p>
          </div>
          <button type="button" onClick={input.onClose}>
            Close
          </button>
        </div>

        <div className="concierge-operator-view-toggle">
          {input.canUseReviewRoleControls ? (
            <button
              type="button"
              className={input.operatorView === "review" ? "active" : ""}
              onClick={() => input.setOperatorView("review")}
            >
              Review
            </button>
          ) : null}
          {input.canUseDebugTrace ? (
            <button
              type="button"
              className={input.operatorView === "debug" ? "active" : ""}
              onClick={() => input.setOperatorView("debug")}
            >
              Debug
            </button>
          ) : null}
        </div>

        {input.operatorView === "review" && input.canUseReviewRoleControls ? (
          <div className="concierge-operator-drawer-body">
            <section className="concierge-panel">
              <h3>Review Controls</h3>
              {!input.isRecommendationContext ? (
                <p>
                  Review controls become available after a recommendation-mode
                  assistant turn.
                </p>
              ) : !input.canUseReviewControls ? (
                <p>
                  Review controls are available only for <code>store_staff</code> or{" "}
                  <code>developer</code>.
                </p>
              ) : (
                <>
                  <div className="concierge-starter-row">
                    <button
                      type="button"
                      onClick={() => input.onReviewAction("approve")}
                      disabled={input.isLoading}
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => input.onReviewAction("reject")}
                      disabled={input.isLoading}
                    >
                      Reject
                    </button>
                    <button
                      type="button"
                      onClick={() => input.onReviewAction("regenerate")}
                      disabled={input.isLoading}
                    >
                      Regenerate
                    </button>
                  </div>
                  <label>
                    Override Message
                    <textarea
                      rows={2}
                      value={input.overrideMessage}
                      onChange={(event) => input.setOverrideMessage(event.target.value)}
                      placeholder="Store-staff final wording..."
                    />
                  </label>
                  <label>
                    Override Rug IDs (comma-separated)
                    <input
                      value={input.overrideRugIds}
                      onChange={(event) => input.setOverrideRugIds(event.target.value)}
                      placeholder="id1,id2,id3"
                    />
                  </label>
                  <label>
                    Override Notes
                    <input
                      value={input.overrideNotes}
                      onChange={(event) => input.setOverrideNotes(event.target.value)}
                      placeholder="why override was needed"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => input.onReviewAction("override")}
                    disabled={input.isLoading}
                  >
                    Apply Override
                  </button>
                </>
              )}
            </section>
            <section className="concierge-panel">
              <h3>Review State</h3>
              <pre>{JSON.stringify(input.reviewState, null, 2)}</pre>
            </section>
          </div>
        ) : null}

        {input.operatorView === "debug" && input.canUseDebugTrace ? (
          <div className="concierge-operator-drawer-body concierge-trace-panel">
            {!input.debug ? (
              <section className="concierge-panel">
                <h3>Debug Disabled</h3>
                <p>
                  Enable debug mode (<code>?debug=1</code>) before sending turns.
                </p>
              </section>
            ) : !input.selectedTurn || input.selectedTurn.role !== "assistant" ? (
              <section className="concierge-panel">
                <h3>No Turn Selected</h3>
                <p>Select an assistant turn from the thread.</p>
              </section>
            ) : input.selectedTurn.debug?.traceError ? (
              <section className="concierge-panel">
                <h3>Trace Error</h3>
                <p>{input.selectedTurn.debug.traceError}</p>
              </section>
            ) : input.selectedTurn.debug?.trace ? (
              <>
                <section className="concierge-panel">
                  <h3>Routing + Decision</h3>
                  <pre>{JSON.stringify(routeTrace?.routing ?? null, null, 2)}</pre>
                </section>
                <section className="concierge-panel">
                  <h3>Pipeline / Context Metrics</h3>
                  <pre>{JSON.stringify(unifiedMetrics, null, 2)}</pre>
                </section>
                <section className="concierge-panel">
                  <h3>AI Request + Response</h3>
                  <pre>{JSON.stringify(unifiedAiTrace, null, 2)}</pre>
                </section>
                <section className="concierge-panel">
                  <h3>Session Snapshot</h3>
                  <pre>{JSON.stringify(routeTrace?.state_snapshot ?? null, null, 2)}</pre>
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
  );
}
