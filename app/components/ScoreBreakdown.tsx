// Layer 2 — "Why this score?" Shows the real component values behind
// opportunity_score (lib/intelligence.ts §14.3), not a re-explanation in
// prose alone — the brief's whole point here is that a user should trust
// the score because they can see the calculation, not just be told about it.
//
// Phase 3B ("Score terminology and explanation layer", the brief's priority
// task): "the front end should explain 'what does this mean?' before 'how
// is this calculated?'". Each row now shows the plain-English description
// (SCORE_COPY[...].lead) directly under the label — always visible, no
// click required — and keeps the methodology text (SCORE_COPY[...].tooltip)
// behind the existing (i) affordance for anyone who wants the calculation
// detail. No formula, value, or component changed — copy only.

import InfoTooltip from "./InfoTooltip";
import { SCORE_COPY } from "@/lib/copy";
import styles from "./ScoreBreakdown.module.css";

function Row({
  label,
  description,
  value,
  tooltip,
  emphasis,
}: {
  label: string;
  description: string;
  value: string;
  tooltip: string;
  emphasis?: boolean;
}) {
  return (
    <div className={`${styles.row} ${emphasis ? styles.emphasis : ""}`}>
      <div className={styles.labelCol}>
        <span className={styles.label}>
          {label}
          <InfoTooltip text={tooltip} />
        </span>
        <span className={styles.description}>{description}</span>
      </div>
      <span className={styles.value}>{value}</span>
    </div>
  );
}

export default function ScoreBreakdown({
  momentumScore,
  investmentEvidencePct,
  adoptionShiftDelta,
  opportunityScore,
}: {
  momentumScore: number | null;
  investmentEvidencePct: number | null;
  adoptionShiftDelta: number | null;
  opportunityScore: number | null;
}) {
  return (
    <div className={`card ${styles.card}`}>
      <h3 className={styles.heading}>Why this score?</h3>
      <div className={styles.rows}>
        <Row
          label={SCORE_COPY.momentum.label}
          description={SCORE_COPY.momentum.lead}
          value={momentumScore === null ? "-" : String(momentumScore)}
          tooltip={SCORE_COPY.momentum.tooltip}
        />
        <Row
          label={SCORE_COPY.investmentEvidence.label}
          description={SCORE_COPY.investmentEvidence.lead}
          value={investmentEvidencePct === null ? "-" : `${investmentEvidencePct}%`}
          tooltip={SCORE_COPY.investmentEvidence.tooltip}
        />
        <Row
          label={SCORE_COPY.adoptionShift.label}
          description={SCORE_COPY.adoptionShift.lead}
          value={
            adoptionShiftDelta === null
              ? "-"
              : `${adoptionShiftDelta >= 0 ? "+" : ""}${adoptionShiftDelta}`
          }
          tooltip={SCORE_COPY.adoptionShift.tooltip}
        />
        <Row
          label={SCORE_COPY.opportunity.label}
          description={SCORE_COPY.opportunity.lead}
          value={opportunityScore === null ? "-" : String(opportunityScore)}
          tooltip={SCORE_COPY.opportunity.tooltip}
          emphasis
        />
      </div>
    </div>
  );
}
