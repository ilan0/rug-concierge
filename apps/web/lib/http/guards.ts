import type { NextResponse } from "next/server";
import type { AppCapability } from "@/lib/auth/capabilities";
import { roleHasCapability } from "@/lib/auth/capabilities";
import {
  getRequestedRoleFromBody,
  resolveRequestRole,
  type RequestRoleFields,
} from "@/lib/auth/request-role";
import type { AppRole } from "@/lib/auth/roles";
import { badRequest, forbidden } from "@/lib/errors/http-errors";

type ResolveApiRoleInput = RequestRoleFields & {
  defaultRole?: AppRole;
  requiredCapability?: AppCapability;
  capabilityErrorMessage?: string;
};

type ResolveApiRoleResult =
  | {
      ok: true;
      role: AppRole;
      source: "cookie" | "request" | "default";
    }
  | {
      ok: false;
      status: 400 | 403;
      message: string;
      response: NextResponse;
    };

export async function resolveApiRoleOrError(
  input: ResolveApiRoleInput
): Promise<ResolveApiRoleResult> {
  const requestedRoleInput = getRequestedRoleFromBody({
    role: input.role,
    user_role: input.user_role,
  });
  if (requestedRoleInput.error) {
    return {
      ok: false,
      status: 400,
      message: requestedRoleInput.error,
      response: badRequest(requestedRoleInput.error),
    };
  }

  const resolution = resolveRequestRole({
    requestedRole: requestedRoleInput.requestedRole,
    defaultRole: input.defaultRole ?? "retail_customer",
  });

  if (
    input.requiredCapability &&
    !roleHasCapability(resolution.role, input.requiredCapability)
  ) {
    return {
      ok: false,
      status: 403,
      message:
        input.capabilityErrorMessage ??
        "This role is not allowed to use this endpoint.",
      response: forbidden(
        input.capabilityErrorMessage ??
          "This role is not allowed to use this endpoint."
      ),
    };
  }

  return {
    ok: true,
    role: resolution.role,
    source: resolution.source,
  };
}

export function requireRoleCapabilityOrError(
  role: AppRole,
  capability: AppCapability,
  message: string
): NextResponse | null {
  if (roleHasCapability(role, capability)) return null;
  return forbidden(message);
}
