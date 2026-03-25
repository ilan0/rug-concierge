import { NextResponse } from "next/server";
import { getResolvedBranding } from "@/lib/branding/tenant-branding";
import { resolveTenantFromRequest } from "@/lib/tenant/resolve-tenant";

export async function GET(req: Request) {
  const tenantResolution = await resolveTenantFromRequest(req);
  if (!tenantResolution.ok) {
    return NextResponse.json(
      { error: tenantResolution.message },
      { status: tenantResolution.status }
    );
  }

  const branding = await getResolvedBranding({
    tenantId: tenantResolution.tenantId,
  });

  const manifest = {
    name: `${branding.storeName} Rug Concierge`,
    short_name: "Rug Concierge",
    start_url: "/concierge",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#f4ece2",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };

  return new NextResponse(JSON.stringify(manifest), {
    status: 200,
    headers: {
      "content-type": "application/manifest+json",
    },
  });
}
