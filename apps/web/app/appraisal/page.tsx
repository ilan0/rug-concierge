import Link from "next/link";
import { AppraisalScreen } from "@/components/appraisal/appraisal-screen";
import { WorkspaceNav } from "@/components/shell/workspace-nav";
import { getServerUiRole } from "@/lib/ui/server-role";
import { canRoleAccessRoute } from "@/lib/auth/policy";

export default async function AppraisalPage() {
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

  return (
    <>
      <WorkspaceNav role={role} currentPath="/appraisal" />
      <AppraisalScreen />
    </>
  );
}
