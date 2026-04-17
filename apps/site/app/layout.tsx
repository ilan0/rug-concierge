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
  title: "Rugdesk | A digital rug salesman for your website",
  description:
    "Rugdesk helps premium rug stores turn website visitors into real customer inquiries, book showroom visits, and digitize inventory faster.",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "Rugdesk | A digital rug salesman for your website",
    description:
      "Help website visitors find rugs they like, save favorites, request a visit, and give your staff a clear next step.",
    url: "https://rugdesk.app",
    siteName: "Rugdesk",
    type: "website",
    images: [
      {
        url: "/media/hero/hero-online-leads.webp",
        width: 1536,
        height: 1024,
        alt: "Rugdesk helping an online shopper browse rugs from home.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Rugdesk | A digital rug salesman for your website",
    description:
      "Turn website traffic into serious customer interest with a digital rug salesman and faster inventory digitization.",
    images: ["/media/hero/hero-online-leads.webp"],
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
