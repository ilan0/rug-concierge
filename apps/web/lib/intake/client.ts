import type {
  IntakeCreateRequest,
  IntakeCreateResponse,
  IntakeDuplicateImageResponse,
  IntakeFinalizeRequest,
  IntakeUploadSessionRequest,
  IntakeUploadSessionResponse,
} from "@/lib/types/intake";
import { mapApiErrorToFriendlyMessage } from "@/lib/ui/error-messages";

const DIRECT_UPLOAD_SIZE_THRESHOLD_BYTES = 6 * 1024 * 1024;
const DIRECT_UPLOAD_MAX_LONG_SIDE_ORIGINAL = 4000;
const DIRECT_UPLOAD_COMPRESSED_LONG_SIDE = 3200;

type PreparedUpload = {
  file: File;
};

type ParsedErrorPayload = {
  error?: unknown;
  code?: unknown;
  existing_rug?: unknown;
};

function toWholeNumber(value: number): number {
  return Math.floor(value);
}

function parseExistingRug(
  payload: { existing_rug?: unknown } | null,
  code: string | null
): IntakeDuplicateImageResponse["existing_rug"] | null {
  if (code !== "DUPLICATE_IMAGE") return null;
  if (!payload || typeof payload.existing_rug !== "object" || !payload.existing_rug) {
    return null;
  }

  const row = payload.existing_rug as Record<string, unknown>;
  const id = typeof row.id === "string" ? row.id.trim() : "";
  if (!id) return null;

  return {
    id,
    label: typeof row.label === "string" ? row.label : null,
  };
}

async function readImageDimensions(
  file: File
): Promise<{ width: number; height: number } | null> {
  try {
    if (typeof createImageBitmap === "function") {
      const bitmap = await createImageBitmap(file);
      const dimensions = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      if (dimensions.width > 0 && dimensions.height > 0) {
        return dimensions;
      }
      return null;
    }
  } catch {
    // Fall back to HTMLImageElement decode below.
  }

  if (typeof window === "undefined" || typeof document === "undefined") {
    return null;
  }

  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const width = image.naturalWidth;
      const height = image.naturalHeight;
      URL.revokeObjectURL(objectUrl);
      if (width > 0 && height > 0) {
        resolve({ width, height });
        return;
      }
      resolve(null);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(null);
    };
    image.src = objectUrl;
  });
}

async function compressImageToJpeg(input: {
  file: File;
  quality: number;
  maxLongSide: number;
}): Promise<File | null> {
  const dims = await readImageDimensions(input.file);
  if (!dims) return null;
  if (typeof document === "undefined") return null;

  const longSide = Math.max(dims.width, dims.height);
  const scale =
    longSide > input.maxLongSide ? input.maxLongSide / longSide : 1;

  const targetWidth = Math.max(1, Math.round(dims.width * scale));
  const targetHeight = Math.max(1, Math.round(dims.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const context = canvas.getContext("2d");
  if (!context) return null;

  const objectUrl = URL.createObjectURL(input.file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("image_decode_failed"));
      img.src = objectUrl;
    });

    context.drawImage(image, 0, 0, targetWidth, targetHeight);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", input.quality)
    );
    if (!blob || blob.size <= 0) return null;

    const fileStem = input.file.name.replace(/\.[^.]+$/, "") || "upload";
    return new File([blob], `${fileStem}.jpg`, {
      type: "image/jpeg",
      lastModified: Date.now(),
    });
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function prepareUploadFile(file: File): Promise<PreparedUpload> {
  const dimensions = await readImageDimensions(file);
  if (!dimensions) {
    // If decode fails (for example HEIC decode edge cases), keep original file.
    return { file };
  }

  const longSide = Math.max(dimensions.width, dimensions.height);
  const needsCompression =
    file.size > DIRECT_UPLOAD_SIZE_THRESHOLD_BYTES ||
    longSide > DIRECT_UPLOAD_MAX_LONG_SIDE_ORIGINAL;

  if (!needsCompression) {
    return { file };
  }

  const firstPass = await compressImageToJpeg({
    file,
    quality: 0.9,
    maxLongSide: DIRECT_UPLOAD_COMPRESSED_LONG_SIDE,
  });
  if (firstPass && firstPass.size <= DIRECT_UPLOAD_SIZE_THRESHOLD_BYTES) {
    return { file: firstPass };
  }

  const secondPass = await compressImageToJpeg({
    file,
    quality: 0.85,
    maxLongSide: DIRECT_UPLOAD_COMPRESSED_LONG_SIDE,
  });
  if (secondPass) {
    return { file: secondPass };
  }

  if (firstPass) {
    return { file: firstPass };
  }

  return { file };
}

function parseErrorDetails(
  payload: ParsedErrorPayload | null
): {
  message: string | null;
  code: string | null;
} {
  if (!payload) return { message: null, code: null };
  return {
    message: typeof payload.error === "string" ? payload.error : null,
    code: typeof payload.code === "string" ? payload.code : null,
  };
}

async function requestUploadSession(
  input: IntakeUploadSessionRequest
): Promise<IntakeUploadSessionResponse> {
  const response = await fetch("/api/inventory/intake/upload-session", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(input),
  });

  const payload = (await response.json().catch(() => null)) as
    | ParsedErrorPayload
    | IntakeUploadSessionResponse
    | null;

  if (!response.ok) {
    const parsed = parseErrorDetails(payload as ParsedErrorPayload | null);
    throw new IntakeRequestError({
      message: mapApiErrorToFriendlyMessage({
        status: response.status,
        code: parsed.code,
        rawMessage: parsed.message,
        context: "intake",
        fallbackMessage: "Unable to start intake upload.",
      }),
      status: response.status,
      code: parsed.code,
      existingRug: null,
    });
  }

  if (
    !payload ||
    typeof payload !== "object" ||
    typeof (payload as IntakeUploadSessionResponse).upload_url !== "string" ||
    typeof (payload as IntakeUploadSessionResponse).storage_path !== "string" ||
    typeof (payload as IntakeUploadSessionResponse).finalize_token !== "string" ||
    typeof (payload as IntakeUploadSessionResponse).expires_at !== "string"
  ) {
    throw new Error("Invalid upload session payload.");
  }

  return payload as IntakeUploadSessionResponse;
}

async function uploadToSignedStorage(input: {
  uploadUrl: string;
  file: File;
}) {
  const response = await fetch(input.uploadUrl, {
    method: "PUT",
    headers: {
      "content-type": input.file.type || "application/octet-stream",
    },
    body: input.file,
  });

  if (!response.ok) {
    throw new IntakeRequestError({
      message: "Unable to upload image to storage. Please try again.",
      status: response.status || 500,
      code: "UPLOAD_FAILED",
      existingRug: null,
    });
  }
}

async function finalizeUpload(input: IntakeFinalizeRequest): Promise<IntakeCreateResponse> {
  const response = await fetch("/api/inventory/intake/finalize", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(input),
  });

  const payload = (await response.json().catch(() => null)) as
    | ParsedErrorPayload
    | IntakeCreateResponse
    | null;

  if (!response.ok) {
    const parsed = parseErrorDetails(payload as ParsedErrorPayload | null);
    const existingRug = parseExistingRug(
      payload as { existing_rug?: unknown } | null,
      parsed.code
    );

    throw new IntakeRequestError({
      message: mapApiErrorToFriendlyMessage({
        status: response.status,
        code: parsed.code,
        rawMessage: parsed.message,
        context: "intake",
        fallbackMessage: "Unable to finalize intake right now.",
      }),
      status: response.status,
      code: parsed.code,
      existingRug,
    });
  }

  if (!payload || typeof payload !== "object" || !("rug" in payload)) {
    throw new Error("Invalid intake finalize payload.");
  }

  return payload as IntakeCreateResponse;
}

export class IntakeRequestError extends Error {
  status: number;
  code: string | null;
  existingRug: IntakeDuplicateImageResponse["existing_rug"] | null;

  constructor(input: {
    message: string;
    status: number;
    code: string | null;
    existingRug: IntakeDuplicateImageResponse["existing_rug"] | null;
  }) {
    super(input.message);
    this.name = "IntakeRequestError";
    this.status = input.status;
    this.code = input.code;
    this.existingRug = input.existingRug;
  }
}

export type IntakeUploadStage = "preparing" | "uploading" | "finalizing";

export async function createInventoryIntake(
  input: IntakeCreateRequest,
  options?: {
    onStageChange?: (stage: IntakeUploadStage) => void;
  }
): Promise<IntakeCreateResponse> {
  options?.onStageChange?.("preparing");
  const prepared = await prepareUploadFile(input.image);

  options?.onStageChange?.("uploading");
  const uploadSession = await requestUploadSession({
    stock_id: input.stock_id ?? null,
    width_ft: toWholeNumber(input.width_ft),
    width_in: toWholeNumber(input.width_in),
    length_ft: toWholeNumber(input.length_ft),
    length_in: toWholeNumber(input.length_in),
    file: {
      filename: prepared.file.name,
      mime_type: prepared.file.type || "application/octet-stream",
      bytes: prepared.file.size,
    },
  });

  await uploadToSignedStorage({
    uploadUrl: uploadSession.upload_url,
    file: prepared.file,
  });

  options?.onStageChange?.("finalizing");
  return finalizeUpload({
    storage_path: uploadSession.storage_path,
    finalize_token: uploadSession.finalize_token,
    client_sha256: null,
  });
}
