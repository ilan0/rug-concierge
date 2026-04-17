import type { Metadata } from "next";
import { Cormorant_Garamond, Manrope } from "next/font/google";
import "./globals.css";

const serif = Cormorant_Garamond({
  subsets: ["latin"],
  variable: "--font-serif",
  weight: ["400", "500", "600", "700"],
});

const sans = Manrope({
  subsets: ["latin"],
  variable: "--font-sans",
  weight: ["400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://rugdesk.app"),
  title: "Rugdesk | Luxury rug showroom software",
  description:
    "Rugdesk helps premium rug showrooms guide customers, organize saved favorites, and follow up with more clarity.",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "Rugdesk | Luxury rug showroom software",
    description:
      "Help customers find the right rug, save what they love, and give your staff a clearer way to follow up.",
    url: "https://rugdesk.app",
    siteName: "Rugdesk",
    type: "website",
    images: [
      {
        url: "/media/hero/hero-composite.webp",
        width: 1536,
        height: 1024,
        alt: "Rugdesk showroom concierge preview.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Rugdesk | Luxury rug showroom software",
    description:
      "Help customers find the right rug, save what they love, and follow up with more clarity.",
    images: ["/media/hero/hero-composite.webp"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable}`}>
      <body>{children}</body>
    </html>
  );
}
