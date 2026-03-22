import { ConciergeScreen } from "@/components/concierge/concierge-screen";
import { AccessGuard } from "@/components/ui/access-guard";
import { isStaffUnlocked } from "@/lib/auth/staff";
import { getResolvedBranding } from "@/lib/branding/tenant-branding";
import { IS_PRODUCTION } from "@/lib/config";
import { getServerUiTenantId } from "@/lib/ui/server-role";
import { redirect } from "next/navigation";

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

  const params = (await searchParams) ?? {};
  const debugAllowed = !IS_PRODUCTION;
  const debug = debugAllowed && readString(params.debug) === "1";
  const branding = await getResolvedBranding();

  return (
    <>
      <ConciergeScreen
        debug={debug}
        tenantId={tenantId}
        storeName={branding.storeName}
        storeLogoUrl={branding.storeLogoUrl}
      />
    </>
  );
}
