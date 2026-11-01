/**
 * PAGE SHELL. Supplies HTML/body, site metadata and global styles around the
 * active page. This file contains no engineering calculations.
 */

import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Building Energy Analysis Selection Tool (BEAST) · HVAC energy comparison",
  description: "Hourly building loads, equipment energy use, and unmet heating and cooling by location and year.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
