import { postOpenAiResponses } from "@/lib/ai/response-quality";
import { OPENAI_API_KEY, OPENAI_VISION_MODEL } from "@/lib/config";
import {
  buildVisionSystemPrompt,
  parseVisionPayload,
  type VisionEnrichmentResult,
  VISION_OUTPUT_JSON_SCHEMA,
} from "@/lib/inventory/vision-contract";
import { formatRugSize } from "@/lib/utils/format";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

export type { VisionEnrichmentResult } from "@/lib/inventory/vision-contract";

export async function requestVisionEnrichment(input: {
  imageUrl: string;
  widthTotalIn: number | null;
  lengthTotalIn: number | null;
}): Promise<VisionEnrichmentResult | null> {
  const sizeDisplay =
    typeof input.widthTotalIn === "number" && typeof input.lengthTotalIn === "number"
      ? formatRugSize(input.widthTotalIn, input.lengthTotalIn)
      : null;

  const requestPayload = {
    model: OPENAI_VISION_MODEL,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: buildVisionSystemPrompt(),
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: sizeDisplay
              ? `Measured size: ${sizeDisplay}. Analyze this rug photo.`
              : "Analyze this rug photo.",
          },
          {
            type: "input_image",
            image_url: input.imageUrl,
          },
        ],
      },
    ],
    max_output_tokens: 450,
    text: {
      format: {
        type: "json_schema",
        name: "rug_vision_enrichment",
        schema: VISION_OUTPUT_JSON_SCHEMA,
        strict: true,
      },
    },
  };

  const response = await postOpenAiResponses({
    url: OPENAI_RESPONSES_URL,
    apiKey: OPENAI_API_KEY,
    requestPayload,
    surface: "vision_enrichment",
  });
  if (!response.ok) {
    return null;
  }

  return parseVisionPayload(response.response_payload);
}
