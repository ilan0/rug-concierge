import { IntakeScreen } from "@/components/intake/intake-screen";
import { WorkspaceNav } from "@/components/shell/workspace-nav";
import { AccessGuard } from "@/components/ui/access-guard";
import { getServerUiRole, getServerUiTenantId } from "@/lib/ui/server-role";
import { canRoleAccessRoute } from "@/lib/auth/policy";
import { getPilotAccessState } from "@/lib/auth/pilot-access";

export default async function IntakePage() {
  const access = await getPilotAccessState();
  if (access.required && !access.verified) {
    return (
      <AccessGuard
        title="Pilot Access Required"
        description="Please unlock pilot access on Home before using intake."
      />
    );
  }

  const role = await getServerUiRole();
  if (!role || !canRoleAccessRoute(role, "/intake")) {
    return (
      <AccessGuard
        title="Inventory Intake"
        description="This page is available only to store staff and developers."
        ctaLabel="Go Home to switch role"
      />
    );
  }

  const tenantId = await getServerUiTenantId();
  if (!tenantId) {
    return (
      <AccessGuard
        title="Store Tenant Required"
        description="Select your store tenant on Home before using intake."
      />
    );
  }

  return (
    <>
      <WorkspaceNav role={role} currentPath="/intake" />
      <IntakeScreen tenantId={tenantId} />
    </>
  );
}
