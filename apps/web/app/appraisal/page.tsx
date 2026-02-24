import Link from "next/link";
import { AppraisalScreen } from "@/components/appraisal/appraisal-screen";
import { WorkspaceNav } from "@/components/shell/workspace-nav";
import { getServerUiRole, getServerUiTenantId } from "@/lib/ui/server-role";
import { canRoleAccessRoute } from "@/lib/auth/policy";
import { getPilotAccessState } from "@/lib/auth/pilot-access";

export default async function AppraisalPage() {
  const access = await getPilotAccessState();
  if (access.required && !access.verified) {
    return (
      <main className="ui-shell role-guard role-guard-blocked">
        <h1>Pilot Access Required</h1>
        <p>Please unlock pilot access on Home before using appraisal.</p>
        <Link href="/">Go Home</Link>
      </main>
    );
  }

  const role = await getServerUiRole();
  if (!role || !canRoleAccessRoute(role, "/appraisal")) {
    return (
      <main className="ui-shell role-guard role-guard-blocked">
        <h1>Appraisal Draft Studio</h1>
        <p>This page is available only to store staff and developers.</p>
        <Link href="/">Go Home to switch role</Link>
      </main>
    );
  }
  const tenantId = await getServerUiTenantId();
  if (!tenantId) {
    return (
      <main className="ui-shell role-guard role-guard-blocked">
        <h1>Store Tenant Required</h1>
        <p>Select your store tenant on Home before using appraisal.</p>
        <Link href="/">Go Home</Link>
      </main>
    );
  }

  return (
    <>
      <WorkspaceNav role={role} currentPath="/appraisal" />
      <AppraisalScreen tenantId={tenantId} />
    </>
  );
}
