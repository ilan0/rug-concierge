import { NextResponse } from "next/server";

function readTrimmedEnv(name: string): string | null {
  const raw = process.env[name];
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function GET() {
  const storeName = readTrimmedEnv("STORE_NAME") ?? "Rug Concierge";

  const manifest = {
    name: `${storeName} Rug Concierge`,
    short_name: "Rug Concierge",
    start_url: "/concierge",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#1a1a1a",
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
