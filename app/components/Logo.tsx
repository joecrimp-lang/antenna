// Lightweight MVP brand mark. Deliberately not a literal radio-antenna
// icon — the "signal" idea is carried by a single small detected-blip mark
// (a dot with a thin surrounding ring, like a ping registering on a scope)
// next to a confident serif wordmark, rather than by an obvious antenna
// glyph. Kept as a component (not baked into the header markup) so it can
// be reused in a footer, favicon treatment, or email capture confirmation
// later without duplicating markup.

import styles from "./Logo.module.css";

export default function Logo({ tagline }: { tagline?: string }) {
  return (
    <div className={styles.wrap}>
      <div className={styles.mark}>
        <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
          <circle cx="11" cy="11" r="9.5" fill="none" stroke="var(--color-gold)" strokeWidth="1" opacity="0.35" />
          <circle cx="11" cy="11" r="5.5" fill="none" stroke="var(--color-gold)" strokeWidth="1.25" opacity="0.6" />
          <circle cx="11" cy="11" r="2.25" fill="var(--color-gold)" />
        </svg>
        <span className={styles.word}>Antenna</span>
      </div>
      {tagline && <p className={styles.tagline}>{tagline}</p>}
    </div>
  );
}
