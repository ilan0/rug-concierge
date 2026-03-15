import { NextResponse } from "next/server";
import { getResolvedBranding } from "@/lib/branding/tenant-branding";

export async function GET() {
  const branding = await getResolvedBranding();

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
