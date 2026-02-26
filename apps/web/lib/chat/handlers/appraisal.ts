import {
  generateAppraisalDraft,
  toAppraisalRequestPayloadPreview,
  toAppraisalResponsePayloadPreview,
  type AppraisalAiTrace,
} from "@/lib/ai/appraisal";
import type {
  AppraisalTurnResponse,
  ChatTurnHandlerInput,
} from "@/lib/chat/types";
import { writeE2eTraceArtifact } from "@/lib/qa/e2e-trace";

// Staff-only appraisal mode handler. Produces structured draft output for downstream export.
export async function handleAppraisalTurn(
  input: ChatTurnHandlerInput
): Promise<AppraisalTurnResponse> {
  const aiTrace: AppraisalAiTrace = {
    called: false,
    model: process.env.OPENAI_MODEL ?? "gpt-4.1-nano",
    request_payload: null,
    response_status: null,
    response_payload: null,
    parsed_response: null,
    fallback_reason: null,
    error: null,
    incomplete_detected: false,
    retry_attempted: false,
    retry_succeeded: false,
    text_postprocess_applied: false,
  };
  const startedAt = Date.now();

  const draft = await generateAppraisalDraft(input.appraisal_context ?? {}, aiTrace);
  const generationTimeMs = Date.now() - startedAt;

  if (input.trace_meta) {
    await writeE2eTraceArtifact({
      meta: {
        run_id: input.trace_meta.run_id,
        case_id: input.trace_meta.case_id,
      },
      channel: "appraisal-ai",
      trace_id: crypto.randomUUID(),
      payload: {
        mode: "appraisal",
        flow_path: ["handleAppraisalTurn", "generateAppraisalDraft"],
        ai_trace: {
          called: aiTrace.called,
          model: aiTrace.model,
          request_payload_preview: toAppraisalRequestPayloadPreview(
            aiTrace.request_payload
          ),
          response_status: aiTrace.response_status,
          response_payload_preview: toAppraisalResponsePayloadPreview(
            aiTrace.response_payload
          ),
          parsed_response: aiTrace.parsed_response,
          fallback_reason: aiTrace.fallback_reason,
          error: aiTrace.error,
          incomplete_detected: aiTrace.incomplete_detected,
          retry_attempted: aiTrace.retry_attempted,
          retry_succeeded: aiTrace.retry_succeeded,
          text_postprocess_applied: aiTrace.text_postprocess_applied,
        },
        timing_ms: {
          generate_appraisal_ms: generationTimeMs,
        },
      },
    });
  }

  return {
    ...draft,
    mode: "appraisal",
  };
}
