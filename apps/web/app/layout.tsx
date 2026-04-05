import type { Metadata } from "next";
import { Manrope, Fraunces } from "next/font/google";
import "./globals.css";
import { LayoutHeader } from "@/components/kiosk/layout-header";
import { AppToaster } from "@/components/ui/sonner";
import { isStaffUnlocked } from "@/lib/auth/staff";

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-sans",
});

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-serif",
});

export const metadata: Metadata = {
  title: "Rug Concierge",
  description: "Rug Concierge pilot workspace",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const unlocked = await isStaffUnlocked();

  return (
    <html lang="en">
      <head>
        <link rel="manifest" href="/api/manifest" />
        <meta name="theme-color" content="#f4ece2" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
      </head>
      <body className={`${manrope.variable} ${fraunces.variable} min-h-screen bg-background font-sans text-foreground antialiased`}>
        <LayoutHeader initialUnlocked={unlocked} />
        {children}
        <AppToaster />
      </body>
    </html>
  );
}
