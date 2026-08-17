// Homepage-only. v1 was a plain non-navigational footer sentence; v2 was a
// collapsible disclosure of name-only pills labelled "Leading themes" /
// "Other tracked areas"; v3 swapped the pills for real ThemeCard instances
// but kept those two labels. This revision drops the labels: the brief's
// point is that the taxonomy will grow over time, and "Other tracked
// areas" reads as a permanent second tier rather than "the rest of the
// landscape, right now". The control is just "View more", and expanding it
// reveals the same dimmed ThemeCard grid as before with no group heading
// above it — still a zero-JS <details>/<summary> disclosure (same
// technique as EvidenceSection.tsx, no client component needed).
//
// otherScores may include themes with no real theme_scores row yet (see
// page.tsx's placeholderThemeScore) — those render through ThemeCard's own
// existing null-score fallbacks, nothing invented here. The opacity dim on
// .otherCard is the only thing distinguishing these from the 5 cards above
// the control; ThemeCard.tsx/module.css itself is untouched.

import type { AntennaTheme } from "@/lib/antennaTaxonomy";
import type { ThemeScore } from "@/lib/supabase";
import ThemeCard, { type LeadingOrganisation } from "./ThemeCard";
import styles from "./ThemeCoverageDisclosure.module.css";

export default function ThemeCoverageDisclosure({
  otherScores,
  leadingOrgsByTheme,
}: {
  otherScores: ThemeScore[];
  leadingOrgsByTheme: Map<AntennaTheme, LeadingOrganisation[]>;
}) {
  if (otherScores.length === 0) return null;

  return (
    <details className={styles.details}>
      <summary className={styles.summary}>
        <span className={styles.label}>View more</span>
        <span className={styles.chevron} aria-hidden="true" />
      </summary>

      <div className={styles.otherGrid}>
        {otherScores.map((score) => (
          <div key={score.id} className={styles.otherCard}>
            <ThemeCard score={score} leadingOrganisations={leadingOrgsByTheme.get(score.theme) ?? []} />
          </div>
        ))}
      </div>
    </details>
  );
}
