import Link from "next/link";
import { ConciergeScreen } from "@/components/concierge/concierge-screen";
import { WorkspaceNav } from "@/components/shell/workspace-nav";
import { getServerUiRole } from "@/lib/ui/server-role";
import { canRoleAccessRoute, canRoleReadDebugTrace } from "@/lib/auth/policy";

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
  const role = await getServerUiRole();
  if (!role || !canRoleAccessRoute(role, "/trade")) {
    return (
      <main className="ui-shell role-guard role-guard-blocked">
        <h1>Trade Support</h1>
        <p>This page is available only to trade clients, staff, or developers.</p>
        <Link href="/">Go Home to switch role</Link>
      </main>
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
        debugToggle={{
          enabled: debug,
          hrefOn: "/trade?debug=1",
          hrefOff: "/trade",
        }}
      />
      <ConciergeScreen debug={debug} variant="trade" />
    </>
  );
}
