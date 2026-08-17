// Layer 4 — companies are supporting evidence, not the primary organising
// structure (per the brief): a plain list grouped by company, each with
// its findings for this theme, sitting below the evidence explorer rather
// than above it.

import styles from "./CompanyList.module.css";

export type CompanyEvidence = {
  companyName: string;
  companyWebsite: string | null;
  findings: string[];
};

export default function CompanyList({ companies }: { companies: CompanyEvidence[] }) {
  if (companies.length === 0) {
    return <p className="empty-state">No contributing organisations recorded for this theme yet.</p>;
  }

  return (
    <div className={styles.grid}>
      {companies.map((c) => (
        <div key={c.companyName} className={`card ${styles.card}`}>
          <div className={styles.companyName}>{c.companyName}</div>
          <ul className={styles.findings}>
            {c.findings.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
