// Site-wide MVP footer/trust layer, rendered once in app/layout.tsx as a
// sibling of <main> (semantically outside it, same as any page footer),
// so every route gets it without duplicating it into page.tsx,
// app/themes/[slug]/page.tsx, and app/organisations/[slug]/page.tsx
// individually.
//
// Deliberately not a legal-heavy corporate footer: no nav columns, no
// social links, no legal boilerplate paragraph. Just the wordmark, one
// line on what Antenna is, the trust/disclaimer line the brief asked for,
// and a copyright + link row.
//
// Privacy / Methodology / Contact now link to real routes (app/privacy,
// app/methodology, app/contact — added alongside this change) instead of
// being plain placeholder text: those pages exist now, so the "use
// placeholders... only if already supported" condition that kept them as
// text before no longer applies. Styling (.link) is the same link-shaped
// treatment the placeholder spans already had, just as an actual <Link>.
import Link from "next/link";
import styles from "./Footer.module.css";

export default function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <p className={styles.wordmark}>Antenna</p>
        <p className={styles.tagline}>
          Media technology intelligence based on publicly available information.
        </p>

        {/* The trust/disclaimer line: intelligence, not prediction. */}
        <p className={styles.disclaimer}>
          Signals and scores are generated from publicly available information and indicate
          market activity, not confirmed future purchasing decisions.
        </p>

        <div className={styles.bottomRow}>
          <p className={styles.copyright}>&copy; {new Date().getFullYear()} Antenna</p>
          <p className={styles.links}>
            <Link href="/privacy" className={styles.link}>
              Privacy
            </Link>
            <span className={styles.linkSeparator} aria-hidden="true">
              |
            </span>
            <Link href="/methodology" className={styles.link}>
              Methodology
            </Link>
            <span className={styles.linkSeparator} aria-hidden="true">
              |
            </span>
            <Link href="/contact" className={styles.link}>
              Contact
            </Link>
          </p>
        </div>
      </div>
    </footer>
  );
}
