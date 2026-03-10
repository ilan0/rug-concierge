import { IntakeScreen } from "@/components/intake/intake-screen";
import { AccessGuard } from "@/components/ui/access-guard";
import { getServerUiTenantId } from "@/lib/ui/server-role";

export default async function IntakePage() {
  const tenantId = await getServerUiTenantId();
  if (!tenantId) {
    return (
      <AccessGuard
        title="Store Tenant Required"
        description="Select your store tenant before using intake."
      />
    );
  }

  return (
    <>
      <IntakeScreen tenantId={tenantId} />
    </>
  );
}
