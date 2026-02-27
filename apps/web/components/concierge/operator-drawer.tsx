import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SectionCard } from "@/components/ui/section-card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
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
    <Sheet
      open={input.open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) input.onClose();
      }}
    >
      <SheetContent side="right" className="flex w-full flex-col gap-4 p-4 sm:max-w-2xl">
        <SheetHeader>
          <div className="flex items-center gap-2">
            <Badge variant="outline">
              {input.selectedTurn?.fineMode
                ? modeLabel(input.selectedTurn.fineMode)
                : "No turn selected"}
            </Badge>
            {input.selectedTurn ? (
              <Badge variant="secondary">{formatTime(input.selectedTurn.createdAt)}</Badge>
            ) : null}
          </div>
          <SheetTitle>Operator</SheetTitle>
          <SheetDescription>
            {input.selectedTurn
              ? "Inspect the selected assistant turn."
              : "Select an assistant turn to inspect."}
          </SheetDescription>
        </SheetHeader>

        <div className="grid grid-cols-2 gap-2">
          {input.canUseReviewRoleControls ? (
            <Button
              type="button"
              variant={input.operatorView === "review" ? "default" : "outline"}
              onClick={() => input.setOperatorView("review")}
            >
              Review
            </Button>
          ) : null}
          {input.canUseDebugTrace ? (
            <Button
              type="button"
              variant={input.operatorView === "debug" ? "default" : "outline"}
              onClick={() => input.setOperatorView("debug")}
            >
              Debug
            </Button>
          ) : null}
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto pr-1">
          {input.operatorView === "review" && input.canUseReviewRoleControls ? (
            <>
              <SectionCard title="Review Controls">
                {!input.isRecommendationContext ? (
                  <p className="text-sm text-muted-foreground">
                    Review controls are available after a recommendation-mode assistant turn.
                  </p>
                ) : !input.canUseReviewControls ? (
                  <p className="text-sm text-muted-foreground">
                    Review controls are available only for store staff or developer.
                  </p>
                ) : (
                  <div className="space-y-3">
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" onClick={() => input.onReviewAction("approve")} disabled={input.isLoading}>
                        Approve
                      </Button>
                      <Button type="button" variant="secondary" onClick={() => input.onReviewAction("reject")} disabled={input.isLoading}>
                        Reject
                      </Button>
                      <Button type="button" variant="secondary" onClick={() => input.onReviewAction("regenerate")} disabled={input.isLoading}>
                        Regenerate
                      </Button>
                    </div>

                    <div className="space-y-2">
                      <p className="text-sm font-medium">Override Message</p>
                      <Textarea
                        rows={3}
                        value={input.overrideMessage}
                        onChange={(event) => input.setOverrideMessage(event.target.value)}
                        placeholder="Final wording for the assistant response"
                      />
                    </div>

                    <div className="space-y-2">
                      <p className="text-sm font-medium">Override Rug IDs</p>
                      <Input
                        value={input.overrideRugIds}
                        onChange={(event) => input.setOverrideRugIds(event.target.value)}
                        placeholder="id1,id2,id3"
                      />
                    </div>

                    <div className="space-y-2">
                      <p className="text-sm font-medium">Override Notes</p>
                      <Input
                        value={input.overrideNotes}
                        onChange={(event) => input.setOverrideNotes(event.target.value)}
                        placeholder="Reason for override"
                      />
                    </div>

                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => input.onReviewAction("override")}
                      disabled={input.isLoading}
                    >
                      Apply Override
                    </Button>
                  </div>
                )}
              </SectionCard>

              <SectionCard title="Review State">
                <pre className="overflow-auto rounded-lg border border-border bg-muted/30 p-3 text-xs">
                  {JSON.stringify(input.reviewState, null, 2)}
                </pre>
              </SectionCard>
            </>
          ) : null}

          {input.operatorView === "debug" && input.canUseDebugTrace ? (
            <>
              {!input.debug ? (
                <SectionCard title="Debug Disabled" description="Enable ?debug=1 before sending turns." />
              ) : !input.selectedTurn || input.selectedTurn.role !== "assistant" ? (
                <SectionCard title="No Turn Selected" description="Select an assistant turn from the thread." />
              ) : input.selectedTurn.debug?.traceError ? (
                <SectionCard title="Trace Error" description={input.selectedTurn.debug.traceError} />
              ) : input.selectedTurn.debug?.trace ? (
                <>
                  <SectionCard title="Routing + Decision">
                    <pre className="overflow-auto rounded-lg border border-border bg-muted/30 p-3 text-xs">
                      {JSON.stringify(routeTrace?.routing ?? null, null, 2)}
                    </pre>
                  </SectionCard>
                  <SectionCard title="Pipeline / Context Metrics">
                    <pre className="overflow-auto rounded-lg border border-border bg-muted/30 p-3 text-xs">
                      {JSON.stringify(unifiedMetrics, null, 2)}
                    </pre>
                  </SectionCard>
                  <SectionCard title="AI Request + Response">
                    <pre className="overflow-auto rounded-lg border border-border bg-muted/30 p-3 text-xs">
                      {JSON.stringify(unifiedAiTrace, null, 2)}
                    </pre>
                  </SectionCard>
                  <SectionCard title="Session Snapshot">
                    <pre className="overflow-auto rounded-lg border border-border bg-muted/30 p-3 text-xs">
                      {JSON.stringify(routeTrace?.state_snapshot ?? null, null, 2)}
                    </pre>
                  </SectionCard>
                </>
              ) : (
                <SectionCard title="No Trace Found" description="Debug must be enabled before sending the turn." />
              )}
            </>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
