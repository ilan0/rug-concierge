import { cookies } from "next/headers";
import { isAppRole, normalizeAppRole, type AppRole } from "@/lib/auth/roles";
import { uiRoleCookieName } from "@/lib/ui/role-session";

export type ResolvedRequestRole = {
  role: AppRole;
  source: "cookie" | "request" | "default";
  cookie_role: AppRole | null;
  request_role: AppRole | null;
  mismatch: boolean;
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

  if (hasRole) {
    return { requestedRole: roleValue, error: null };
  }
  if (hasUserRole) {
    return { requestedRole: userRoleValue, error: null };
  }
  return { requestedRole: undefined, error: null };
}

export async function getRequestCookieRole(): Promise<AppRole | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(uiRoleCookieName)?.value;
  if (!raw || !isAppRole(raw)) return null;
  return raw;
}

export async function resolveRequestRole(input?: {
  requestedRole?: unknown;
  defaultRole?: AppRole;
}): Promise<ResolvedRequestRole> {
  const cookieRole = await getRequestCookieRole();
  const requestRole =
    input?.requestedRole && isAppRole(input.requestedRole)
      ? input.requestedRole
      : null;
  const mismatch = Boolean(
    cookieRole && requestRole && cookieRole !== requestRole
  );

  if (cookieRole) {
    return {
      role: cookieRole,
      source: "cookie",
      cookie_role: cookieRole,
      request_role: requestRole,
      mismatch,
    };
  }

  if (requestRole) {
    return {
      role: requestRole,
      source: "request",
      cookie_role: null,
      request_role: requestRole,
      mismatch: false,
    };
  }

  return {
    role: normalizeAppRole(input?.defaultRole, "retail_customer"),
    source: "default",
    cookie_role: null,
    request_role: null,
    mismatch: false,
  };
}
