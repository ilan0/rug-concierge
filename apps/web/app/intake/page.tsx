import { IntakeScreen } from "@/components/intake/intake-screen";
import { AccessGuard } from "@/components/ui/access-guard";
import { isStaffUnlocked } from "@/lib/auth/staff";
import { getServerUiTenantId } from "@/lib/ui/server-role";
import { redirect } from "next/navigation";

export default async function IntakePage() {
  const tenantId = await getServerUiTenantId();
  const unlocked = await isStaffUnlocked();
  if (!tenantId) {
    return (
      <AccessGuard
        title="Store Tenant Required"
        description="Select your store tenant before using intake."
      />
    );
  }

  if (!unlocked) {
    redirect("/concierge");
  }

  return (
    <>
      <IntakeScreen tenantId={tenantId} />
    </>
  );
}
