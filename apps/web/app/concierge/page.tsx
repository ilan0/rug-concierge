import { ConciergeScreen } from "@/components/concierge/concierge-screen";
import { WorkspaceNav } from "@/components/shell/workspace-nav";
import Link from "next/link";
import { getServerUiRole, getServerUiTenantId } from "@/lib/ui/server-role";
import { canRoleAccessRoute, canRoleReadDebugTrace } from "@/lib/auth/policy";
import { getPilotAccessState } from "@/lib/auth/pilot-access";

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
  const access = await getPilotAccessState();
  if (access.required && !access.verified) {
    return (
      <main className="ui-shell role-guard role-guard-blocked">
        <h1>Pilot Access Required</h1>
        <p>Please unlock pilot access on Home before using concierge.</p>
        <Link href="/">Go Home</Link>
      </main>
    );
  }

  const role = await getServerUiRole();
  if (!role || !canRoleAccessRoute(role, "/concierge")) {
    return (
      <main className="ui-shell role-guard role-guard-blocked">
        <h1>Rug Concierge</h1>
        <p>Please choose an allowed role on Home to use concierge.</p>
        <Link href="/">Go Home</Link>
      </main>
    );
  }

  const tenantId = await getServerUiTenantId();
  if (!tenantId) {
    return (
      <main className="ui-shell role-guard role-guard-blocked">
        <h1>Store Tenant Required</h1>
        <p>Select your store tenant on Home before using concierge.</p>
        <Link href="/">Go Home</Link>
      </main>
    );
  }

  const params = (await searchParams) ?? {};
  const debugAllowed = role ? canRoleReadDebugTrace(role) : false;
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
        debugToggle={debugToggle}
      />
      <ConciergeScreen debug={debug} tenantId={tenantId} />
    </>
  );
}
