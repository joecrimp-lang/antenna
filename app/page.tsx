// Public homepage. This route is the first step of the Homepage -> Market
// Overview -> Theme Detail -> Evidence -> Organisation journey.
//
// Phase 3B.2 ("Product Polish & Trust Layer") tightens the hero per the
// decision doc §4: "the proposition is strong but the current hero area is
// too wordy." The rewritten copy leads with what Antenna is, why it
// matters, and what's explorable, in three short lines instead of one
// dense paragraph, and mentions the "Antenna" name once rather than
// repeating it through the hero. A visual divider now separates the hero
// from Market Overview (decision doc: "create clearer separation between
// brand/proposition, market overview, theme intelligence"). No em dashes
// anywhere in this file's copy, per the decision doc §2.

import { getSupabase, type ThemeScore } from "@/lib/supabase";
import type { AntennaTheme } from "@/lib/antennaTaxonomy";
import { companyToSlug } from "@/lib/companySlug";
import { SCORE_COPY } from "@/lib/copy";
import Header from "./components/Header";
import ThemeCard, { type LeadingOrganisation } from "./components/ThemeCard";
import InfoTooltip from "./components/InfoTooltip";
import EmailCapture from "./components/EmailCapture";
import styles from "./home.module.css";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

async function getTopThemes(): Promise<{ themes: ThemeScore[]; error: string | null }> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("theme_scores")
    .select("*")
    .order("opportunity_score", { ascending: false, nullsFirst: false })
    .limit(5);

  if (error) {
    console.error("Supabase error loading theme_scores:", error);
    return { themes: [], error: error.message };
  }

  return { themes: (data ?? []) as ThemeScore[], error: null };
}

// "Leading activity": which organisations are actually driving each theme,
// not how many. One query across every theme shown on the homepage,
// ordered by signal_intent_score (the strongest, best-evidenced activity
// first) so the first few distinct company names seen per theme are the
// most representative ones. Same underlying data the theme detail page
// already reads, no new table, no new scoring.
const LEADING_ORGS_PER_THEME = 4;
const LEADING_ORGS_QUERY_LIMIT = 500; // defensive cap, not a real limit at this project's scale

async function getLeadingOrganisations(
  themes: AntennaTheme[]
): Promise<Map<AntennaTheme, LeadingOrganisation[]>> {
  const result = new Map<AntennaTheme, LeadingOrganisation[]>();
  if (themes.length === 0) return result;

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("signals")
    .select("theme, company:companies(name)")
    .in("theme", themes as string[])
    .order("signal_intent_score", { ascending: false, nullsFirst: false })
    .limit(LEADING_ORGS_QUERY_LIMIT);

  if (error || !data) {
    console.error("Supabase error loading leading organisations:", error);
    return result;
  }

  for (const row of data as unknown as {
    theme: AntennaTheme | null;
    company: { name: string } | null;
  }[]) {
    if (!row.theme || !row.company?.name) continue;
    const list = result.get(row.theme) ?? [];
    if (list.length >= LEADING_ORGS_PER_THEME) continue;
    if (list.some((o) => o.name === row.company!.name)) continue;
    list.push({ name: row.company.name, slug: companyToSlug(row.company.name) });
    result.set(row.theme, list);
  }

  return result;
}

export default async function Home() {
  const { themes, error } = await getTopThemes();
  const leadingOrgsByTheme = await getLeadingOrganisations(themes.map((t) => t.theme));

  return (
    <main>
      <Header tagline="Media technology intelligence" />

      <section className={styles.hero}>
        <p className="eyebrow">Antenna</p>
        <h1 className={styles.headline}>Know where media technology investment is moving.</h1>
        <p className={styles.subhead}>
          Real evidence of technology spend across media and entertainment: expenditure,
          procurement, hiring and partnerships, not headlines or hype.
        </p>
        <div className={styles.heroCapture}>
          <EmailCapture source="homepage_hero" />
        </div>
      </section>

      <div className={styles.heroDivider} />

      {error && (
        <div className="error-banner">
          <strong>Supabase query error:</strong> {error}
        </div>
      )}

      <section className="section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Market Overview</p>
            <h2>Where investment is concentrating right now</h2>
          </div>
        </div>

        <p className={styles.sectionSubhead}>
          Ranked by Opportunity Score: a combined read on momentum, investment evidence and
          adoption. A theme with heavy activity but weak evidence of real spend ranks below a
          quieter theme with stronger investment signals, and that gap is the point. Each card
          opens with a Market Signal, our read on what&apos;s happening, ahead of the scores
          behind it.
        </p>

        <div className={styles.legend}>
          <span>
            <span className={`${styles.legendDot} ${styles.legendDotGold}`} />
            {SCORE_COPY.opportunity.label}: {SCORE_COPY.opportunity.short}
            <InfoTooltip text={SCORE_COPY.opportunity.tooltip} />
          </span>
          <span>
            <span className={`${styles.legendDot} ${styles.legendDotTeal}`} />
            {SCORE_COPY.momentum.label}: {SCORE_COPY.momentum.short}
            <InfoTooltip text={SCORE_COPY.momentum.tooltip} />
          </span>
        </div>

        {themes.length === 0 && !error && (
          <p className="empty-state">
            No theme scores yet. Our intelligence layer computes these after each research run.
            Check back after the next scheduled run.
          </p>
        )}

        <div className={styles.grid}>
          {themes.map((score) => (
            <ThemeCard
              key={score.id}
              score={score}
              leadingOrganisations={leadingOrgsByTheme.get(score.theme) ?? []}
            />
          ))}
        </div>
      </section>

      <section className={styles.closing}>
        <div className={`card ${styles.closingCard}`}>
          <h2 className={styles.closingHeading}>Get early access</h2>
          <p className={styles.closingBody}>
            We&apos;re in early development. Leave your details and we&apos;ll be in touch as the
            product develops. No spam, no obligation.
          </p>
          <EmailCapture source="homepage_closing" />
        </div>
      </section>
    </main>
  );
}
