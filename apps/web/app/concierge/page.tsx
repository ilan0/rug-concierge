import { ConciergeScreen } from "@/components/concierge/concierge-screen";
import { AccessGuard } from "@/components/ui/access-guard";
import { getResolvedBranding } from "@/lib/branding/tenant-branding";
import { getServerUiTenantId } from "@/lib/ui/server-role";

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
  if (!tenantId) {
    return (
      <AccessGuard
        title="Store Tenant Required"
        description="Select your store tenant on Home before using concierge."
      />
    );
  }

  const params = (await searchParams) ?? {};
  const debugAllowed = process.env.NODE_ENV !== "production";
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
