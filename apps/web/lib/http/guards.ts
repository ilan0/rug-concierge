import type { NextResponse } from "next/server";
import type { AppCapability } from "@/lib/auth/capabilities";
import { roleHasCapability } from "@/lib/auth/capabilities";
import {
  getRequestedRoleFromBody,
  resolveRequestRole,
  type RequestRoleFields,
} from "@/lib/auth/request-role";
import { getServerDeploymentType } from "@/lib/auth/deployment";
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

function isPrivilegedRole(role: AppRole): boolean {
  return role === "store_staff" || role === "developer";
}

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

  const resolution = await resolveRequestRole({
    requestedRole: requestedRoleInput.requestedRole,
    defaultRole: input.defaultRole ?? "retail_customer",
  });

  if (resolution.blocked_non_retail_request) {
    return {
      ok: false,
      status: 403,
      message: "Non-retail roles require a signed access cookie from /join.",
      response: forbidden("Non-retail roles require a signed access cookie from /join."),
    };
  }

  if (resolution.mismatch) {
    return {
      ok: false,
      status: 403,
      message: "Role mismatch between cookie and request payload.",
      response: forbidden("Role mismatch between cookie and request payload."),
    };
  }

  if (isPrivilegedRole(resolution.role) && resolution.source !== "cookie") {
    const deploymentType = getServerDeploymentType();
    if (deploymentType === "developer") {
      return {
        ok: true,
        role: resolution.role,
        source: resolution.source,
      };
    }
    return {
      ok: false,
      status: 403,
      message: "Privileged roles require a synced role cookie from the UI session.",
      response: forbidden(
        "Privileged roles require a synced role cookie from the UI session."
      ),
    };
  }

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
