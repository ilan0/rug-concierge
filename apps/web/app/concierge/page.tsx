import { ConciergeScreen } from "@/components/concierge/concierge-screen";
import { WorkspaceNav } from "@/components/shell/workspace-nav";
import { AccessGuard } from "@/components/ui/access-guard";
import { getServerUiRole, getServerUiTenantId } from "@/lib/ui/server-role";
import { canRoleAccessRoute } from "@/lib/auth/policy";

type ConciergePageProps = {
  searchParams?:
    | Promise<Record<string, string | string[] | undefined>>
    | Record<string, string | string[] | undefined>;
};

function readString(
  value: string | string[] | undefined,
  fallback = ""
): string {
  if (typeof value === "string") return value;
  return fallback;
}

export default async function ConciergePage({ searchParams }: ConciergePageProps) {
  const role = await getServerUiRole();
  if (!role || !canRoleAccessRoute(role, "/concierge")) {
    return (
      <AccessGuard
        title="Rug Concierge"
        description="Please choose an allowed role on Home to use concierge."
      />
    );
  }

  const tenantId = await getServerUiTenantId();
  if (!tenantId) {
    return (
      <AccessGuard
        title="Store Tenant Required"
        description="Select your store tenant on Home before using concierge."
      />
    );
  }

  const params = (await searchParams) ?? {};
  const debugAllowed = role === "developer";
  const debug = debugAllowed && readString(params.debug) === "1";
  const debugToggle = debugAllowed
    ? {
        enabled: debug,
        hrefOn: "/concierge?debug=1",
        hrefOff: "/concierge",
      }
    : undefined;

  return (
    <>
      <WorkspaceNav
        role={role}
        currentPath="/concierge"
        variant="concierge-minimal"
        showHomeLink={role === "developer"}
        debugToggle={debugToggle}
      />
      <ConciergeScreen debug={debug} tenantId={tenantId} />
    </>
  );
}
