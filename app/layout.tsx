import "./globals.css";
import type { ReactNode } from "react";
import { Source_Serif_4, Inter } from "next/font/google";

// Two-typeface system: a distinguished serif for headlines/editorial prose
// (the "intelligence report" register) and a clean grotesk for UI chrome,
// labels, and numerals (scores need to read precisely, not decoratively).
// Both loaded via next/font/google — bundled with Next.js itself, no new
// package dependency, self-hosted at build time (no runtime request to
// Google Fonts, no layout shift).
const serif = Source_Serif_4({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-serif",
  display: "swap",
});

const sans = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata = {
  title: "Antenna — Media Technology Intelligence",
  description:
    "Antenna identifies where media and entertainment technology investment is moving, and explains the evidence behind it.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable}`}>
      <body>{children}</body>
    </html>
  );
}
