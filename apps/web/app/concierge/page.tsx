import { ConciergeScreen } from "@/components/concierge/concierge-screen";
import { WorkspaceNav } from "@/components/shell/workspace-nav";
import { getServerUiRole } from "@/lib/ui/server-role";
import { canRoleReadDebugTrace } from "@/lib/auth/policy";

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
  const params = (await searchParams) ?? {};
  const debugAllowed = role ? canRoleReadDebugTrace(role) : false;
  const debug = debugAllowed && readString(params.debug) === "1";

  return (
    <>
      <WorkspaceNav
        role={role}
        currentPath="/concierge"
        debugToggle={{
          enabled: debug,
          hrefOn: "/concierge?debug=1",
          hrefOff: "/concierge",
        }}
      />
      <ConciergeScreen debug={debug} />
    </>
  );
}
