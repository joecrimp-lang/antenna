// Shared shell for the three MVP trust pages (methodology, privacy,
// contact). All three are plain prose, same layout, so this avoids
// triplicating the header/back-link/title markup rather than giving each
// page its own copy of it. Not a new design system: reuses the existing
// global .eyebrow/.section classes and Header component exactly as the
// homepage and theme/organisation pages already do, just without any of
// the data-driven layers (scores, evidence, etc.) those pages have.

import Link from "next/link";
import type { ReactNode } from "react";
import Header from "./Header";
import styles from "./StaticPage.module.css";

export default function StaticPage({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <main>
      <Header tagline="Media technology intelligence" />

      <Link href="/" className={styles.back}>
        ← Antenna
      </Link>

      <div className={styles.titleRow}>
        <p className="eyebrow">{eyebrow}</p>
        <h1 className={styles.title}>{title}</h1>
      </div>

      <div className={styles.prose}>{children}</div>
    </main>
  );
}
