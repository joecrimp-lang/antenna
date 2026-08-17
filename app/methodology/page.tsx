// MVP trust page. Static prose, no data fetching, no dynamic route params.
// Content mirrors, and should stay consistent with, the score terminology
// already used throughout the product (lib/copy.ts's SCORE_COPY, and the
// Opportunity/Momentum/Investment Evidence/Adoption Shift fields on
// theme_scores) rather than introducing new names for the same things.
// The closing line is the same disclaimer sentence used in the site
// footer (Footer.tsx), deliberately word-for-word so the two don't drift
// into two slightly different claims about what a score means.

import StaticPage from "../components/StaticPage";

export const metadata = {
  title: "Methodology — Antenna",
};

export default function MethodologyPage() {
  return (
    <StaticPage eyebrow="Trust" title="Methodology">
      <p>
        Antenna is built entirely from publicly available information: news coverage, company
        announcements, job postings, procurement and tender notices, investment and funding
        disclosures, and other public market evidence. Antenna does not use private, confidential
        or non-public data.
      </p>

      <p>
        <strong>What Antenna tracks.</strong> Individual signals include technology initiatives,
        partnerships, hiring activity, investment indicators, procurement signals, and other
        publicly reported market evidence relevant to media and entertainment technology.
      </p>

      <p>
        <strong>How scores are built.</strong> Antenna's scores combine four components: Momentum
        (the pace at which activity is increasing), Investment Evidence (the share of signals that
        are high confidence evidence of real buying activity), Adoption Shift (whether evidence is
        moving toward confirmed spend or staying in early strategy and hiring), and Opportunity (a
        combined read across momentum, investment evidence and adoption).
      </p>

      <p>
        Signals and scores are generated from publicly available information and indicate market
        activity and opportunity signals, not confirmed future purchasing decisions.
      </p>
    </StaticPage>
  );
}
