// A restrained score visual — a labeled horizontal bar, not a chart. Used
// for both Momentum and Opportunity so the two are always visually
// distinguishable (color) while reading as the same kind of measurement
// (same component, same 0-100 scale, same layout).

import styles from "./ScoreIndicator.module.css";

type Variant = "gold" | "teal";

export default function ScoreIndicator({
  label,
  value,
  variant,
  size = "md",
}: {
  label: string;
  value: number | null;
  variant: Variant;
  size?: "md" | "lg";
}) {
  const pct = value === null ? 0 : Math.max(0, Math.min(100, value));
  return (
    <div className={`${styles.wrap} ${size === "lg" ? styles.lg : ""}`}>
      <div className={styles.labelRow}>
        <span className={styles.label}>{label}</span>
        <span className={`${styles.value} ${variant === "gold" ? styles.gold : styles.teal}`}>
          {value === null ? "-" : value}
        </span>
      </div>
      <div className={styles.track} role="img" aria-label={`${label}: ${value === null ? "not yet scored" : `${value} out of 100`}`}>
        <div
          className={`${styles.fill} ${variant === "gold" ? styles.fillGold : styles.fillTeal}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
