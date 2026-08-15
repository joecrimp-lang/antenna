import "./globals.css";
import type { ReactNode } from "react";

export const metadata = {
  title: "Tech Spend Signal Monitor",
  description:
    "Monitors media & entertainment companies for public signals of future technology spending.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
