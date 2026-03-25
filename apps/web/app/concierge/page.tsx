import { ConciergeScreen } from "@/components/concierge/concierge-screen";
import { AccessGuard } from "@/components/ui/access-guard";
import { isStaffUnlocked } from "@/lib/auth/staff";
import { getResolvedBranding } from "@/lib/branding/tenant-branding";
import { getServerUiTenantId } from "@/lib/ui/server-role";
import { redirect } from "next/navigation";

export default async function ConciergePage() {
  const tenantId = await getServerUiTenantId();
  const unlocked = await isStaffUnlocked();
  if (!tenantId) {
    return (
      <AccessGuard
        title="Store Tenant Required"
        description="Select your store tenant on Home before using concierge."
      />
    );
  }

  if (unlocked) {
    redirect("/inventory");
  }

  const branding = await getResolvedBranding();

  return (
    <>
      <ConciergeScreen
        tenantId={tenantId}
        storeName={branding.storeName}
        storeLogoUrl={branding.storeLogoUrl}
      />
    </>
  );
}
