import { IntakeScreen } from "@/components/intake/intake-screen";
import { AccessGuard } from "@/components/ui/access-guard";
import { isStaffUnlocked } from "@/lib/auth/staff";
import { getServerUiTenantId } from "@/lib/ui/server-role";
import { redirect } from "next/navigation";

export default async function IntakePage() {
  const tenantId = await getServerUiTenantId();
  const unlocked = tenantId ? await isStaffUnlocked(tenantId) : false;
  if (!tenantId) {
    return (
      <AccessGuard
        title="Store not found"
        description="Store not found."
      />
    );
  }

  if (!unlocked) {
    redirect("/concierge");
  }

  return (
    <>
      <IntakeScreen />
    </>
  );
}
