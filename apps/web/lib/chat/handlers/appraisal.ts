import { generateAppraisalDraft } from "@/lib/ai/appraisal";
import type {
  AppraisalTurnResponse,
  ChatTurnHandlerInput,
} from "@/lib/chat/types";

// Staff-only appraisal mode handler. Produces structured draft output for downstream export.
export async function handleAppraisalTurn(
  input: ChatTurnHandlerInput
): Promise<AppraisalTurnResponse> {
  const draft = await generateAppraisalDraft(input.appraisal_context ?? {});

  return {
    ...draft,
    mode: "appraisal",
  };
}
