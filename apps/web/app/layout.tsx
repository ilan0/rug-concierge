import type { Metadata } from "next";
import { Manrope, Fraunces } from "next/font/google";
import "./globals.css";
import KioskNav from "@/components/kiosk/kiosk-nav";
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
        <header
          aria-label="Store header"
          className="sticky top-0 z-40 border-b border-border/35 bg-background/92 shadow-[0_1px_0_rgba(60,39,15,0.05)] backdrop-blur supports-[backdrop-filter]:bg-background/80"
        >
          <KioskNav initialUnlocked={unlocked} />
        </header>
        {children}
        <AppToaster />
      </body>
    </html>
  );
}
