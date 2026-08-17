import Link from "next/link";
import type { ThemeScore } from "@/lib/supabase";
import { themeToSlug } from "@/lib/themeSlug";
import ScoreIndicator from "./ScoreIndicator";
import styles from "./ThemeCard.module.css";

const STRENGTH_LABEL: Record<string, string> = {
  strong: "Strong",
  emerging: "Emerging",
  limited: "Limited",
};

export default function ThemeCard({ score }: { score: ThemeScore }) {
  return (
    <Link href={`/themes/${themeToSlug(score.theme)}`} className={`card ${styles.card}`}>
      <div className={styles.top}>
        <h3 className={styles.title}>{score.theme}</h3>
        {score.opportunity_strength && (
          <span className={`badge badge--${score.opportunity_strength}`}>
            {STRENGTH_LABEL[score.opportunity_strength]}
          </span>
        )}
      </div>

      <div className={styles.scores}>
        <ScoreIndicator label="Opportunity" value={score.opportunity_score} variant="gold" />
        <ScoreIndicator label="Momentum" value={score.momentum_score} variant="teal" />
      </div>

      <p className={styles.summary}>
        {score.narrative_summary ?? "Editorial analysis pending for this theme."}
      </p>

      <div className={styles.meta}>
        <span>
          <strong>{score.signals_count}</strong> signal{score.signals_count === 1 ? "" : "s"}
        </span>
        <span>
          <strong>{score.organisations_count}</strong> organisation{score.organisations_count === 1 ? "" : "s"}
        </span>
      </div>
    </Link>
  );
}
