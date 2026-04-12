import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Rugdesk",
  description: "Luxury rug concierge software for modern showrooms.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
