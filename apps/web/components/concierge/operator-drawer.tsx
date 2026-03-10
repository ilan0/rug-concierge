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
import type { Turn, OperatorView } from "@/components/concierge/types";
import { formatTime, modeLabel } from "@/components/concierge/utils";

type OperatorDrawerProps = {
  open: boolean;
  selectedTurn: Turn | null;
  debug: boolean;
  canUseDebugTrace: boolean;
  operatorView: OperatorView;
  setOperatorView: (view: OperatorView) => void;
  onClose: () => void;
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

        <div className="grid grid-cols-1 gap-2">
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
