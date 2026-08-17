// Public homepage — Chunk 3 (Market Intelligence Experience MVP). Replaces
// the old operator dashboard that used to live at "/" (last run status +
// raw signal list). That view is no longer reachable from the product; see
// the Chunk 3 delivery report for why, and where it could resurface (e.g.
// an /admin or /status route) if it's still wanted later. This route is the
// first step of the Homepage → Market Overview → Theme Detail → Evidence →
// Companies journey described in the brief.

import { getSupabase, type ThemeScore } from "@/lib/supabase";
import Header from "./components/Header";
import ThemeCard from "./components/ThemeCard";
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

export default async function Home() {
  const { themes, error } = await getTopThemes();

  return (
    <main>
      <Header tagline="Media technology intelligence" />

      <section className={styles.hero}>
        <p className="eyebrow">Antenna</p>
        <h1 className={styles.headline}>
          Know where media technology investment is moving — before the market does.
        </h1>
        <p className={styles.subhead}>
          Antenna evaluates public evidence of enterprise technology spend across the media
          and entertainment industry — weighing how strong, how widespread, and how far along
          each signal really is — to identify where investment is genuinely gaining ground.
          It is not a news feed and it does not rank markets by how often they&apos;re mentioned.
        </p>
        <div className={styles.heroCapture}>
          <EmailCapture source="homepage_hero" />
        </div>
      </section>

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
          Ranked by Opportunity Score — a combined read on momentum, investment evidence, and
          adoption. A theme with heavy activity but weak evidence of real spend will rank below
          a quieter theme with stronger investment signals; that gap is the point.
        </p>

        <div className={styles.legend}>
          <span>
            <span className={`${styles.legendDot} ${styles.legendDotGold}`} />
            Opportunity — momentum + investment evidence + adoption movement combined
            <InfoTooltip text="A generic (non-personalised) read on how attractive a theme currently looks for a media technology supplier — combining Market Momentum with evidence of real investment activity and whether adoption is accelerating. Two themes with the same signal volume can have very different Opportunity Scores." />
          </span>
          <span>
            <span className={`${styles.legendDot} ${styles.legendDotTeal}`} />
            Momentum — volume and spread of market activity
            <InfoTooltip text="How many organisations are active in a theme and how strong the underlying signals are. High momentum means a theme is being talked and acted on widely — it does not by itself mean the spend is real or committed yet." />
          </span>
        </div>

        {themes.length === 0 && !error && (
          <p className="empty-state">
            No theme scores yet. Antenna&apos;s intelligence layer computes these after each
            research run — check back after the next scheduled run.
          </p>
        )}

        <div className={styles.grid}>
          {themes.map((score) => (
            <ThemeCard key={score.id} score={score} />
          ))}
        </div>
      </section>

      <section className={styles.closing}>
        <div className={`card ${styles.closingCard}`}>
          <h2 className={styles.closingHeading}>Get early access</h2>
          <p className={styles.closingBody}>
            Antenna is in early development. Leave your email and we&apos;ll be in touch as the
            product develops — no spam, no obligation.
          </p>
          <EmailCapture source="homepage_closing" />
        </div>
      </section>
    </main>
  );
}
