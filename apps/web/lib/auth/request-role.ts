import {
  isAppRole,
  normalizeAppRole,
  type AppRole,
} from "@/lib/auth/roles";
import { isPasscodeGated } from "@/lib/auth/deployment";

export type ResolvedRequestRole = {
  role: AppRole;
  source: "request" | "default";
  request_role: AppRole | null;
};

export type RequestRoleFields = {
  role?: unknown;
  user_role?: unknown;
};

export function getRequestedRoleFromBody(input: RequestRoleFields): {
  requestedRole: unknown;
  error: string | null;
} {
  const roleValue =
    typeof input.role === "string" ? input.role.trim() : input.role;
  const userRoleValue =
    typeof input.user_role === "string"
      ? input.user_role.trim()
      : input.user_role;
  const hasRole = roleValue !== undefined && roleValue !== null && roleValue !== "";
  const hasUserRole =
    userRoleValue !== undefined && userRoleValue !== null && userRoleValue !== "";

  if (hasRole && hasUserRole && roleValue !== userRoleValue) {
    return {
      requestedRole: roleValue,
      error: "role and user_role must match when both are provided.",
    };
  }

  if (hasRole) return { requestedRole: roleValue, error: null };
  if (hasUserRole) return { requestedRole: userRoleValue, error: null };
  return { requestedRole: undefined, error: null };
}

export async function resolveRequestRole(input?: {
  requestedRole?: unknown;
  defaultRole?: AppRole;
}): Promise<ResolvedRequestRole> {
  if (isPasscodeGated()) {
    return {
      role: "store_staff",
      source: "default",
      request_role: null,
    };
  }

  const requestRole =
    input?.requestedRole && isAppRole(input.requestedRole)
      ? input.requestedRole
      : null;

  const allowDeveloperRole = process.env.NODE_ENV !== "production";
  if (requestRole && (requestRole !== "developer" || allowDeveloperRole)) {
    return {
      role: requestRole,
      source: "request",
      request_role: requestRole,
    };
  }

  return {
    role: normalizeAppRole(input?.defaultRole, "retail_customer"),
    source: "default",
    request_role: null,
  };
}
