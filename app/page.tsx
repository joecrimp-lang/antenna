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
//
// Theme coverage refinement: Market Overview still leads with exactly the
// top 5 themes by opportunity_score, unchanged ranking. What changed is
// how the OTHER themes are surfaced: v1 was a plain footer sentence, v2
// was a name-only pill list; this version replaces that pill list with
// real ThemeCard instances for the other themes too, behind the same
// zero-JS <details> disclosure (ThemeCoverageDisclosure, same technique as
// EvidenceSection.tsx), so a visitor who expands it sees something that
// reads as more of the product rather than a taxonomy dump.
//
// getThemeScores below now fetches ALL theme_scores rows in the same
// order as before (opportunity_score descending), just without the old
// .limit(5) — the SQL ordering, and therefore which 5 count as "leading",
// is completely unchanged; slicing the same ordered array at [0,5) vs
// [5,] in Home() below is the only thing new. Themes with no theme_scores
// row at all (Antenna hasn't generated intelligence for them yet) still
// need to appear in "Other tracked areas" per the brief ("a user should
// understand Antenna monitors a complete landscape of 10 areas"), so
// placeholderThemeScore below fills in a ThemeScore-shaped object for
// those with every score/count field null or zero, never invented data.
// ThemeCard already renders that correctly with its EXISTING fallback
// behaviour: computeMarketSignal (lib/marketSignal.ts, untouched) already
// maps momentum_score === null / signals_count === 0 to the "Limited"
// state, and ScoreIndicator (untouched) already renders a null score as
// "-". No new visual state, no new scoring logic, just reusing what
// scored-but-thin themes already looked like.
//
// The Market Overview subhead was trimmed from a 4-sentence methodology
// paragraph down to one line: the Opportunity/Momentum legend below it
// already explains the scores (via InfoTooltip), and each card's own
// Market Signal badge already carries the momentum-vs-evidence read Chunk
// 3/Phase 3B.1 designed it to carry, so restating that in prose was
// redundant with what's already on screen.
//
// Final polish pass: dropped "ranked by Opportunity Score" from the
// subhead too (scoring mechanics live in the legend/tooltips, not this
// sentence) and removed ThemeCoverageDisclosure's "Leading themes (shown
// above)" / "Other tracked areas" labels and its "View all N tracked
// areas" count, now just "View more" — the taxonomy will grow over time,
// and labelling the expanded set "other"/permanently secondary implied a
// fixed tier that doesn't reflect that. leadingScores/otherScores here are
// unchanged; only the labels a visitor sees changed.

import { getSupabase, type ThemeScore } from "@/lib/supabase";
import { ANTENNA_THEMES, type AntennaTheme } from "@/lib/antennaTaxonomy";
import { companyToSlug } from "@/lib/companySlug";
import { SCORE_COPY } from "@/lib/copy";
import Header from "./components/Header";
import ThemeCard, { type LeadingOrganisation } from "./components/ThemeCard";
import ThemeCoverageDisclosure from "./components/ThemeCoverageDisclosure";
import InfoTooltip from "./components/InfoTooltip";
import EmailCapture from "./components/EmailCapture";
import styles from "./home.module.css";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

async function getThemeScores(): Promise<{ scores: ThemeScore[]; error: string | null }> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("theme_scores")
    .select("*")
    .order("opportunity_score", { ascending: false, nullsFirst: false });

  if (error) {
    console.error("Supabase error loading theme_scores:", error);
    return { scores: [], error: error.message };
  }

  return { scores: (data ?? []) as ThemeScore[], error: null };
}

// A theme Antenna tracks (it's in the static taxonomy) but hasn't generated
// any intelligence for yet (no theme_scores row exists). Every field below
// is null/zero, not a guess — see the header comment for why that's safe
// to hand to ThemeCard as-is.
function placeholderThemeScore(theme: AntennaTheme, index: number): ThemeScore {
  return {
    id: -1000 - index, // negative: guaranteed not to collide with a real row's serial id
    theme,
    window_days: 0,
    signals_count: 0,
    organisations_count: 0,
    high_intent_signal_count: 0,
    signal_diversity: 0,
    velocity_pct: null,
    momentum_score: null,
    investment_evidence_pct: null,
    adoption_shift_delta: null,
    opportunity_score: null,
    opportunity_strength: null,
    scoring_reason: null,
    scoring_version: "not_yet_scored",
    computed_at: "",
    narrative_summary: null,
    narrative: null,
    narrative_generated_at: null,
  };
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
  const { scores, error } = await getThemeScores();

  // Same ordered array as before, just not truncated by SQL: [0, 5) is
  // exactly what getTopThemes() used to return (still ranked by
  // opportunity_score, still exactly 5), [5, ) is themes 6-10 that DO have
  // real scores but aren't in the leading set. Themes with no row at all
  // are added separately below via placeholderThemeScore.
  const leadingScores = scores.slice(0, 5);
  const otherScoredThemes = scores.slice(5);

  const scoredThemeNames = new Set(scores.map((s) => s.theme));
  const unscoredThemes = ANTENNA_THEMES.filter((t) => !scoredThemeNames.has(t));
  const otherScores: ThemeScore[] = [
    ...otherScoredThemes,
    ...unscoredThemes.map((theme, i) => placeholderThemeScore(theme, i)),
  ];

  // Leading organisations only meaningfully exist for themes with actual
  // signals, so this still reads correctly for placeholder themes (the map
  // simply won't have an entry, and ThemeCard's leadingOrganisations prop
  // already defaults to an empty array). Broadened from "leading 5" to
  // "every theme with a real score row" so the other-themes cards can show
  // it too, same query, same function, just a wider theme list.
  const leadingOrgsByTheme = await getLeadingOrganisations(scores.map((s) => s.theme));

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
            <h2>Leading themes</h2>
          </div>
        </div>

        <p className={styles.sectionSubhead}>
          Antenna tracks {ANTENNA_THEMES.length} technology areas across media and entertainment.
          These are the themes currently showing the strongest market signals.
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

        {leadingScores.length === 0 && !error && (
          <p className="empty-state">
            No theme scores yet. Our intelligence layer computes these after each research run.
            Check back after the next scheduled run.
          </p>
        )}

        <div className={styles.grid}>
          {leadingScores.map((score) => (
            <ThemeCard
              key={score.id}
              score={score}
              leadingOrganisations={leadingOrgsByTheme.get(score.theme) ?? []}
            />
          ))}
        </div>

        <ThemeCoverageDisclosure otherScores={otherScores} leadingOrgsByTheme={leadingOrgsByTheme} />
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
