import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Climate Table · School heating & cooling loads",
  description: "Explore hourly temperature, dew point, and simulated heating and cooling loads for a 150,000 ft² K–12 school by US city, state, and year.",
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
