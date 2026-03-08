import { cookies } from "next/headers";
import { isAppRole, normalizeAppRole, type AppRole } from "@/lib/auth/roles";
import { verifySignedRoleCookieValue } from "@/lib/auth/role-cookie";
import { resolveAuthoritativeTenantForServer } from "@/lib/auth/tenant";
import { getServerDeploymentType, type DeploymentType } from "@/lib/auth/deployment";
import { uiRoleCookieName, uiTenantCookieName } from "@/lib/ui/role-session";

export type ResolvedRequestRole = {
  role: AppRole;
  source: "cookie" | "request" | "default";
  cookie_role: AppRole | null;
  request_role: AppRole | null;
  mismatch: boolean;
  blocked_non_retail_request: boolean;
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
  const rawRoleCookie = cookieStore.get(uiRoleCookieName)?.value ?? null;
  const cookieTenantId = cookieStore.get(uiTenantCookieName)?.value ?? null;
  const tenantId = resolveAuthoritativeTenantForServer({
    cookieTenantId,
  });
  return verifySignedRoleCookieValue({
    rawCookieValue: rawRoleCookie,
    tenantId,
  });
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
  return resolveRoleFromInputs({
    deploymentType: getServerDeploymentType(),
    cookieRole,
    requestRole,
    defaultRole: input?.defaultRole,
  });
}

export function resolveRoleFromInputs(input: {
  deploymentType: DeploymentType;
  cookieRole: AppRole | null;
  requestRole: AppRole | null;
  defaultRole?: AppRole;
}): ResolvedRequestRole {
  const mismatch = Boolean(
    input.cookieRole && input.requestRole && input.cookieRole !== input.requestRole
  );

  if (input.cookieRole) {
    return {
      role: input.cookieRole,
      source: "cookie",
      cookie_role: input.cookieRole,
      request_role: input.requestRole,
      mismatch,
      blocked_non_retail_request: false,
    };
  }

  if (
    input.deploymentType !== "developer" &&
    input.requestRole &&
    input.requestRole !== "retail_customer"
  ) {
    return {
      role: "retail_customer",
      source: "default",
      cookie_role: null,
      request_role: input.requestRole,
      mismatch: false,
      blocked_non_retail_request: true,
    };
  }

  if (input.requestRole) {
    return {
      role: input.requestRole,
      source: "request",
      cookie_role: null,
      request_role: input.requestRole,
      mismatch: false,
      blocked_non_retail_request: false,
    };
  }

  return {
    role: normalizeAppRole(input.defaultRole, "retail_customer"),
    source: "default",
    cookie_role: null,
    request_role: null,
    mismatch: false,
    blocked_non_retail_request: false,
  };
}
