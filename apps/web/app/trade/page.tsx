import { ConciergeScreen } from "@/components/concierge/concierge-screen";
import { WorkspaceNav } from "@/components/shell/workspace-nav";
import { AccessGuard } from "@/components/ui/access-guard";
import { getServerUiRole, getServerUiTenantId } from "@/lib/ui/server-role";
import { canRoleAccessRoute, canRoleReadDebugTrace } from "@/lib/auth/policy";
import { getPilotAccessState } from "@/lib/auth/pilot-access";
import { getServerDeploymentType } from "@/lib/auth/deployment";
import { redirect } from "next/navigation";

type TradePageProps = {
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

export default async function TradePage({ searchParams }: TradePageProps) {
  const deploymentType = getServerDeploymentType();
  const access = await getPilotAccessState();
  if (access.required && !access.verified) {
    return (
      <AccessGuard
        title="Pilot Access Required"
        description="Please unlock pilot access on Home before using trade support."
      />
    );
  }

  const role = await getServerUiRole();
  if (deploymentType === "staff" && !role) {
    redirect("/join");
  }

  if (!role || !canRoleAccessRoute(role, "/trade")) {
    return (
      <AccessGuard
        title="Trade Support"
        description="This page is available only to trade clients, staff, or developers."
        ctaLabel="Go Home to switch role"
      />
    );
  }

  const tenantId = await getServerUiTenantId();
  if (!tenantId) {
    return (
      <AccessGuard
        title="Store Tenant Required"
        description="Select your store tenant on Home before using trade support."
      />
    );
  }

  const params = (await searchParams) ?? {};
  const debugAllowed = canRoleReadDebugTrace(role);
  const debug = debugAllowed && readString(params.debug) === "1";

  return (
    <>
      <WorkspaceNav
        role={role}
        currentPath="/trade"
        variant="workspace-soft"
        debugToggle={
          debugAllowed
            ? {
                enabled: debug,
                hrefOn: "/trade?debug=1",
                hrefOff: "/trade",
              }
            : undefined
        }
      />
      <ConciergeScreen debug={debug} variant="trade" tenantId={tenantId} />
    </>
  );
}
