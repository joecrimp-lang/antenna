// Native <details>/<summary> — accessible, keyboard-operable, and
// zero-JS expand/collapse, so this doesn't need a client component. Styled
// to look like an intentional editorial section, not a raw disclosure
// widget. "Default view should be editorial, do not dump raw database
// tables" — each item shown here is a company + a one-line human summary,
// not a table of signal rows.

import styles from "./EvidenceSection.module.css";

export type EvidenceItem = {
  companyName: string;
  summary: string;
};

export default function EvidenceSection({
  title,
  signalCount,
  organisationCount,
  items,
  defaultOpen = false,
}: {
  title: string;
  signalCount: number;
  organisationCount: number;
  items: EvidenceItem[];
  defaultOpen?: boolean;
}) {
  if (signalCount === 0) return null;

  return (
    <details className={styles.details} open={defaultOpen}>
      <summary className={styles.summary}>
        <span className={styles.title}>{title}</span>
        <span className={styles.count}>
          {signalCount} signal{signalCount === 1 ? "" : "s"} · {organisationCount} organisation
          {organisationCount === 1 ? "" : "s"}
        </span>
      </summary>
      <ul className={styles.list}>
        {items.map((item, i) => (
          <li key={i} className={styles.item}>
            <span className={styles.company}>{item.companyName}</span>
            <span className={styles.itemSummary}>{item.summary}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
