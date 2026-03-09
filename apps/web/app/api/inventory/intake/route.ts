import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { rugImagePathToPublicUrl } from "@/lib/storage/rug-images";
import { badRequest, forbidden, internalError } from "@/lib/errors/http-errors";
import {
  normalizeTenantId,
  resolveAuthoritativeTenantForServer,
} from "@/lib/auth/tenant";
import { requirePilotAccessApi } from "@/lib/auth/pilot-access";
import { resolveApiRoleOrError } from "@/lib/http/guards";
import { parseE2eTraceMeta, writeE2eTraceArtifact } from "@/lib/qa/e2e-trace";
import {
  parseDimensionField,
  validateDimensionTuple,
  validateImageFile,
  validateIntakeLabel,
} from "@/lib/intake/validation";
import type { RoleType } from "@/lib/chat/types";

const RUG_IMAGES_BUCKET = "rug-images";
const QA_FAIL_STEP_HEADER = "x-intake-test-fail-step";
const QA_RUG_ID_HEADER = "x-intake-test-rug-id";
const QA_MODE_ENABLED = process.env.QA_MODE === "1";

const INTAKE_FAIL_STEPS = [
  "before_insert_rug",
  "after_insert_rug",
  "before_upload_image",
  "after_upload_image",
  "before_insert_rug_image",
  "after_insert_rug_image",
  "throw_after_upload",
] as const;

type IntakeFailStep = (typeof INTAKE_FAIL_STEPS)[number];

type ParsedIntakeForm = {
  role?: RoleType;
  user_role?: RoleType;
  tenantId: string | null;
  intakeLabel: string;
  widthFt: number;
  widthIn: number;
  lengthFt: number;
  lengthIn: number;
  image: File;
};

type CleanupInput = {
  tenantId: string | null;
  rugId: string | null;
  storagePath: string | null;
};

type CleanupResult = {
  rugDeleted: boolean;
  imageDeleted: boolean;
  errors: string[];
};

function readTrimmedString(value: FormDataEntryValue | null): string {
  if (typeof value !== "string") return "";
  return value.trim();
}

function readQaFailStep(req: Request): IntakeFailStep | null {
  if (!QA_MODE_ENABLED) return null;
  const raw = req.headers.get(QA_FAIL_STEP_HEADER)?.trim() ?? "";
  if (!raw) return null;
  return INTAKE_FAIL_STEPS.find((step) => step === raw) ?? null;
}

function readQaRugId(req: Request): string | null {
  if (!QA_MODE_ENABLED) return null;
  const raw = req.headers.get(QA_RUG_ID_HEADER)?.trim() ?? "";
  if (!raw) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw)) {
    return null;
  }
  return raw.toLowerCase();
}

function isFailStep(
  requestedStep: IntakeFailStep | null,
  currentStep: IntakeFailStep
): boolean {
  return requestedStep === currentStep;
}

function extensionForImage(image: File): string {
  const type = image.type.toLowerCase();
  if (type === "image/jpeg" || type === "image/jpg") return "jpg";
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  if (type === "image/heic") return "heic";
  if (type === "image/heif") return "heif";
  if (type === "image/avif") return "avif";

  const byName = image.name
    .split(".")
    .pop()
    ?.trim()
    .toLowerCase();
  if (byName && /^[a-z0-9]{2,6}$/.test(byName)) return byName;
  return "jpg";
}

function buildStoragePath(tenantId: string, rugId: string, image: File): string {
  const ext = extensionForImage(image);
  return `${tenantId}/${rugId}/primary-${Date.now()}.${ext}`;
}

function parseIntakeForm(
  formData: FormData
): { ok: true; form: ParsedIntakeForm } | { ok: false; response: NextResponse } {
  const labelResult = validateIntakeLabel(formData.get("intake_label"));
  if (!labelResult.ok) {
    return { ok: false, response: badRequest(labelResult.error) };
  }

  const dimensionsResult = validateDimensionTuple({
    widthFt: parseDimensionField(formData.get("width_ft"), "width_ft"),
    widthIn: parseDimensionField(formData.get("width_in"), "width_in"),
    lengthFt: parseDimensionField(formData.get("length_ft"), "length_ft"),
    lengthIn: parseDimensionField(formData.get("length_in"), "length_in"),
  });
  if (!dimensionsResult.ok) {
    return { ok: false, response: badRequest(dimensionsResult.error) };
  }

  const imageResult = validateImageFile(formData.get("image"));
  if (!imageResult.ok) {
    return { ok: false, response: badRequest(imageResult.error) };
  }

  const tenantId = normalizeTenantId(formData.get("tenant_id"));

  return {
    ok: true,
    form: {
      role: readTrimmedString(formData.get("role")) as RoleType | undefined,
      user_role: readTrimmedString(formData.get("user_role")) as RoleType | undefined,
      tenantId,
      intakeLabel: labelResult.value,
      widthFt: dimensionsResult.value.widthFt,
      widthIn: dimensionsResult.value.widthIn,
      lengthFt: dimensionsResult.value.lengthFt,
      lengthIn: dimensionsResult.value.lengthIn,
      image: imageResult.file,
    },
  };
}

async function cleanupIntakeWrite(input: CleanupInput): Promise<CleanupResult> {
  const errors: string[] = [];
  let rugDeleted = false;
  let imageDeleted = false;

  if (input.storagePath) {
    const { error } = await supabaseAdmin.storage
      .from(RUG_IMAGES_BUCKET)
      .remove([input.storagePath]);
    if (error) {
      errors.push(`storage_remove_failed:${error.message}`);
    } else {
      imageDeleted = true;
    }
  }

  if (input.tenantId && input.rugId) {
    const { error } = await supabaseAdmin
      .from("rugs")
      .delete()
      .eq("tenant_id", input.tenantId)
      .eq("id", input.rugId);
    if (error) {
      errors.push(`rug_delete_failed:${error.message}`);
    } else {
      rugDeleted = true;
    }
  }

  return {
    rugDeleted,
    imageDeleted,
    errors,
  };
}

export async function POST(req: Request) {
  const startedAt = Date.now();
  const traceMeta = parseE2eTraceMeta(req);
  const traceId = crypto.randomUUID();
  const failStep = readQaFailStep(req);
  const qaRequestedRugId = readQaRugId(req);
  const flowPath: string[] = ["/api/inventory/intake POST"];

  let tenantId: string | null = null;
  let rugId: string | null = null;
  let storagePath: string | null = null;

  const withIntakeHeaders = (response: NextResponse): NextResponse => {
    response.headers.set("x-intake-route-trace-id", traceId);
    if (rugId) {
      response.headers.set("x-intake-rug-id", rugId);
    }
    if (QA_MODE_ENABLED && storagePath) {
      response.headers.set("x-intake-storage-path", storagePath);
    }
    if (QA_MODE_ENABLED && failStep) {
      response.headers.set(QA_FAIL_STEP_HEADER, failStep);
    }
    return response;
  };

  const pilotBlocked = await requirePilotAccessApi();
  if (pilotBlocked) return withIntakeHeaders(pilotBlocked);

  try {
    const formData = await req.formData().catch(() => null);
    if (!(formData instanceof FormData)) {
      return withIntakeHeaders(badRequest("Invalid multipart form payload."));
    }

    const parsed = parseIntakeForm(formData);
    if (!parsed.ok) {
      return withIntakeHeaders(parsed.response);
    }
    flowPath.push("validate_form");

    const roleResult = await resolveApiRoleOrError({
      role: parsed.form.role,
      user_role: parsed.form.user_role,
      defaultRole: "retail_customer",
      requiredCapability: "inventory.intake",
      capabilityErrorMessage: "This role is not allowed to intake inventory.",
    });
    if (!roleResult.ok) {
      if (roleResult.status === 403) {
        return withIntakeHeaders(forbidden(roleResult.message));
      }
      return withIntakeHeaders(badRequest(roleResult.message));
    }
    flowPath.push("resolve_role");

    tenantId = resolveAuthoritativeTenantForServer({
      requestTenantId: parsed.form.tenantId,
    });
    if (!tenantId) {
      return withIntakeHeaders(badRequest("tenant_id is required."));
    }
    flowPath.push("normalize_tenant");

    rugId = qaRequestedRugId ?? crypto.randomUUID();

    if (isFailStep(failStep, "before_insert_rug")) {
      return withIntakeHeaders(
        internalError("Unable to create intake record.", "CHAT_INTERNAL_ERROR")
      );
    }

    const insertedRug = await supabaseAdmin
      .from("rugs")
      .insert({
        id: rugId,
        tenant_id: tenantId,
        intake_label: parsed.form.intakeLabel,
        status: "available",
        width_ft: parsed.form.widthFt,
        width_in: parsed.form.widthIn,
        length_ft: parsed.form.lengthFt,
        length_in: parsed.form.lengthIn,
        price: null,
        sale_price: null,
      })
      .select(
        "id, tenant_id, intake_label, status, price, sale_price, width_ft, width_in, length_ft, length_in, width_total_in, length_total_in, created_at"
      )
      .single();

    if (insertedRug.error || !insertedRug.data) {
      return withIntakeHeaders(
        internalError("Unable to create intake record.", "CHAT_INTERNAL_ERROR")
      );
    }
    flowPath.push("insert_rug");

    if (isFailStep(failStep, "after_insert_rug")) {
      const cleanup = await cleanupIntakeWrite({
        tenantId,
        rugId,
        storagePath: null,
      });
      if (traceMeta) {
        await writeE2eTraceArtifact({
          meta: traceMeta,
          channel: "inventory-intake-route",
          trace_id: traceId,
          payload: {
            flow_path: [...flowPath, "forced_after_insert_rug", "rollback"],
            request: {
              tenant_id: tenantId,
              rug_id: rugId,
            },
            rollback: cleanup,
            response: {
              status: 500,
              body: {
                error: "Unable to upload intake image.",
                code: "CHAT_INTERNAL_ERROR",
              },
            },
            timing_ms: {
              total_ms: Date.now() - startedAt,
            },
          },
        });
      }
      return withIntakeHeaders(internalError("Unable to upload intake image."));
    }

    storagePath = buildStoragePath(tenantId, rugId, parsed.form.image);

    if (isFailStep(failStep, "before_upload_image")) {
      const cleanup = await cleanupIntakeWrite({
        tenantId,
        rugId,
        storagePath: null,
      });
      if (traceMeta) {
        await writeE2eTraceArtifact({
          meta: traceMeta,
          channel: "inventory-intake-route",
          trace_id: traceId,
          payload: {
            flow_path: [...flowPath, "forced_before_upload_image", "rollback"],
            request: {
              tenant_id: tenantId,
              rug_id: rugId,
            },
            rollback: cleanup,
            response: {
              status: 500,
              body: {
                error: "Unable to upload intake image.",
                code: "CHAT_INTERNAL_ERROR",
              },
            },
            timing_ms: {
              total_ms: Date.now() - startedAt,
            },
          },
        });
      }
      return withIntakeHeaders(internalError("Unable to upload intake image."));
    }

    const imageBuffer = Buffer.from(await parsed.form.image.arrayBuffer());
    const upload = await supabaseAdmin.storage
      .from(RUG_IMAGES_BUCKET)
      .upload(storagePath, imageBuffer, {
        contentType: parsed.form.image.type || "application/octet-stream",
        upsert: false,
      });
    if (upload.error || isFailStep(failStep, "after_upload_image")) {
      const cleanup = await cleanupIntakeWrite({
        tenantId,
        rugId,
        storagePath: upload.error ? null : storagePath,
      });
      if (traceMeta) {
        await writeE2eTraceArtifact({
          meta: traceMeta,
          channel: "inventory-intake-route",
          trace_id: traceId,
          payload: {
            flow_path: [...flowPath, "upload_image_failed", "rollback"],
            request: {
              tenant_id: tenantId,
              rug_id: rugId,
            },
            rollback: cleanup,
            response: {
              status: 500,
              body: {
                error: "Unable to upload intake image.",
                code: "CHAT_INTERNAL_ERROR",
              },
            },
            timing_ms: {
              total_ms: Date.now() - startedAt,
            },
          },
        });
      }
      return withIntakeHeaders(internalError("Unable to upload intake image."));
    }
    flowPath.push("upload_image");

    if (isFailStep(failStep, "throw_after_upload")) {
      throw new Error("Forced intake failure after upload");
    }

    if (isFailStep(failStep, "before_insert_rug_image")) {
      const cleanup = await cleanupIntakeWrite({
        tenantId,
        rugId,
        storagePath,
      });
      if (traceMeta) {
        await writeE2eTraceArtifact({
          meta: traceMeta,
          channel: "inventory-intake-route",
          trace_id: traceId,
          payload: {
            flow_path: [...flowPath, "forced_before_insert_rug_image", "rollback"],
            request: {
              tenant_id: tenantId,
              rug_id: rugId,
              storage_path: storagePath,
            },
            rollback: cleanup,
            response: {
              status: 500,
              body: {
                error: "Unable to finalize intake image metadata.",
                code: "CHAT_INTERNAL_ERROR",
              },
            },
            timing_ms: {
              total_ms: Date.now() - startedAt,
            },
          },
        });
      }
      return withIntakeHeaders(
        internalError("Unable to finalize intake image metadata.")
      );
    }

    const imageInsert = await supabaseAdmin
      .from("rug_images")
      .insert({
        tenant_id: tenantId,
        rug_id: rugId,
        path: storagePath,
        is_primary: true,
        sort_order: 0,
      })
      .select("rug_id")
      .single();
    if (
      imageInsert.error ||
      !imageInsert.data ||
      isFailStep(failStep, "after_insert_rug_image")
    ) {
      const cleanup = await cleanupIntakeWrite({
        tenantId,
        rugId,
        storagePath,
      });
      if (traceMeta) {
        await writeE2eTraceArtifact({
          meta: traceMeta,
          channel: "inventory-intake-route",
          trace_id: traceId,
          payload: {
            flow_path: [...flowPath, "insert_rug_image_failed", "rollback"],
            request: {
              tenant_id: tenantId,
              rug_id: rugId,
              storage_path: storagePath,
            },
            rollback: cleanup,
            response: {
              status: 500,
              body: {
                error: "Unable to finalize intake image metadata.",
                code: "CHAT_INTERNAL_ERROR",
              },
            },
            timing_ms: {
              total_ms: Date.now() - startedAt,
            },
          },
        });
      }
      return withIntakeHeaders(
        internalError("Unable to finalize intake image metadata.")
      );
    }
    flowPath.push("insert_rug_image");

    const primaryImageUrl = rugImagePathToPublicUrl(supabaseAdmin, storagePath);
    const responseBody = {
      rug: {
        ...insertedRug.data,
        primary_image_url: primaryImageUrl,
        primary_image_path: storagePath,
      },
    };

    if (traceMeta) {
      await writeE2eTraceArtifact({
        meta: traceMeta,
        channel: "inventory-intake-route",
        trace_id: traceId,
        payload: {
          flow_path: flowPath,
          request: {
            role: roleResult.role,
            tenant_id: tenantId,
            intake_label: parsed.form.intakeLabel,
            width_ft: parsed.form.widthFt,
            width_in: parsed.form.widthIn,
            length_ft: parsed.form.lengthFt,
            length_in: parsed.form.lengthIn,
            image_bytes: parsed.form.image.size,
            image_type: parsed.form.image.type,
          },
          response: {
            status: 200,
            body: {
              rug_id: insertedRug.data.id,
              tenant_id: insertedRug.data.tenant_id,
            },
          },
          timing_ms: {
            total_ms: Date.now() - startedAt,
          },
        },
      });
    }

    return withIntakeHeaders(NextResponse.json(responseBody));
  } catch {
    if (rugId && tenantId) {
      await cleanupIntakeWrite({
        tenantId,
        rugId,
        storagePath,
      });
    }
    return withIntakeHeaders(internalError("Unable to intake rug right now."));
  }
}
