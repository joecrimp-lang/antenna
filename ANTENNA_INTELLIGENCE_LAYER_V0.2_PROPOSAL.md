# Antenna Intelligence Layer v0.2 — Proposal

**Status: APPROVED AND IMPLEMENTED.** All four flagged structural decisions (§8) were resolved by the user and the resulting design was built exactly as specified below — `supabase/003_antenna_intelligence_v0.2.sql`, `lib/intelligence.ts`, and two new steps wired into `lib/runResearch.ts`. This document is kept as the historical proposal/decision record; `ANTENNA_SCORING_MODEL.md` §14 is the living reference for the methodology as implemented.

Companion reading: `ANTENNA_SCORING_MODEL.md` (the v0.1 classification methodology this builds on), `Antenna_Intelligence_Model_v0.1_Scoring_Spec.docx`, `Antenna_Product_Direction_and_Decisions.docx`.

---

## 0. Scope guardrails (restating what this chunk is and isn't)

Confirmed in scope: Signal Intent Score, Market Momentum Score, a **generic** (non-personalised) Opportunity Score, all as stored/queryable data — no new UI.

Explicitly out of scope for this chunk (per the brief, and reaffirmed here so nothing drifts in unapproved):
- No new UI of any kind.
- No changes to `lib/research.ts` — the research prompt, the OpenAI call, the model, or what gets collected per company. Every input this proposal uses already exists in the `signals` table today.
- No new data sources, no new OpenAI calls. Everything below is computed in application code (deterministic formulas) from data already stored by the v0.1 classification pass.
- No company-first scoring, no company-level aggregation (§11 of `ANTENNA_SCORING_MODEL.md` remains an unapproved, unimplemented proposal — not touched here).
- No personalisation / User Fit / supplier-profile scoring — the Opportunity Score here answers "is this market area attractive for a generic media technology supplier," not "is this attractive for *you*."
- "Historical Pattern Intelligence" (§3 of the scoring spec doc) is explicitly marked there as a future development area — not part of this chunk.
- The free/paid product experience and commercial funnel (from `Antenna_Product_Direction_and_Decisions.docx`) are product/commercial decisions, not intelligence-layer work — not touched here.

## 1. What v0.1 already gives us

This matters because it shapes the whole approach: **the five inputs the new spec asks for (intent stage, specificity, evidence strength, recency, scale/materiality) are the same five factors the v0.1 classification prompt already uses**, in the same priority order, to produce the existing `intent_score` on every signal (see `ANTENNA_SCORING_MODEL.md` §5 — "Within a band, rank the exact number by, in order: buying stage, specificity, evidence strength, recency, then scale/materiality").

The one structural difference: v0.1 kept *evidence strength/certainty* as a **separate** output (`confidence_score`) rather than folding it into intent, because it's answering a different question ("is this evidence real and correctly interpreted" vs. "how strong is the buying signal"). v0.1 also doesn't apply any **time decay** — `intent_score` is fixed at classification time and never ages.

So Signal Intent Score isn't a new classification pass. It's a **deterministic re-derivation**, in code, of the existing `intent_score` and `confidence_score` — folding confidence in as a dampener and adding recency decay (which a static, classification-time score structurally can't have) and a small materiality bump from `confirmed_spend_amount`. This is exactly why it can be built without touching research collection or adding a data source: everything it needs is already sitting in the `signals` table.

## 2. Signal Intent Score

**Formula:**

```
confidence_multiplier = 0.7 + 0.3 × (confidence_score / 100)        // 0.70 – 1.00
recency_multiplier    = recency_curve(days_since_evidence_date)      // see below
spend_bonus            = confirmed_spend_amount is not null ? 5 : 0

signal_intent_score = clamp(
  round(intent_score × confidence_multiplier × recency_multiplier) + spend_bonus,
  0, 100
)
```

`days_since_evidence_date` uses `published_date` when present, falling back to `created_at` (the date Antenna found it) when the source didn't state one — consistent with how `published_date` is already treated as optional elsewhere.

**Recency curve** (proposed, parameters open for adjustment):

| Age | Multiplier |
|---|---|
| 0–90 days | 1.00 (full weight) |
| 91–365 days | linear decay from 1.00 → 0.60 |
| 366–545 days (up to 18 months) | linear decay from 0.60 → 0.30 |
| beyond 18 months | excluded from Market Momentum / Opportunity aggregation entirely; `signal_intent_score` still computed and stored (floor 0.30) so the signal itself never loses its value, it just stops contributing to "what's happening now" |

Rationale for a floor rather than decaying to zero: old evidence isn't false, it's just less indicative of *current* momentum — same principle already established in the (unimplemented but approved-style) §11 proposal ("full weight ≤90 days, decaying to a floor, not zero").

**Why a multiplier on confidence rather than a separate score:** intent stage is explicitly "highest importance" per the spec — a multiplicative dampener lets low confidence meaningfully discount a score without ever letting weak evidence out-rank strong buying-stage evidence from a *more* confident source, and without confidence swamping intent the way a simple average would.

**`scoring_reason`:** code-generated (not model-generated — this is a deterministic formula, there's nothing for a model to explain), e.g.:

> "Base intent 88 (buying-stage signal), confidence 92% → ×0.98, evidence 12 days old → full recency weight, no confirmed spend figure. → 86."

This is a distinct field from the existing `classification_reason` (which stays exactly as-is — it's the model's explanation for why it picked the *raw* `confidence_score`/`intent_score` in the first place). `scoring_reason` explains the *derivation* on top of those raw scores. Keeping them separate preserves the audit trail: you can always see both "why the model scored the raw evidence this way" and "why the composite score came out this way."

**Worked examples:**

*Example A — BBC Studios AI Creative Lab (from the spec doc's own example):* `intent_score` = 86 (per spec example), assume `confidence_score` = 90 (official announcement), evidence 12 days old, no confirmed spend.
```
confidence_multiplier = 0.7 + 0.3×0.90 = 0.97
recency_multiplier    = 1.00 (12 days, within 90-day full-weight window)
signal_intent_score   = round(86 × 0.97 × 1.00) + 0 = round(83.4) = 83
```

*Example B — a weaker, older signal:* `intent_score` = 70 (strategic commitment), `confidence_score` = 55 (trade-press inference), evidence 200 days old.
```
confidence_multiplier = 0.7 + 0.3×0.55 = 0.865
recency_multiplier    = 1.00 − (200−90)/(365−90) × 0.40 = 1.00 − 0.16 = 0.84   // linear interpolation in the 91–365 band
signal_intent_score   = round(70 × 0.865 × 0.84) + 0 = round(50.9) = 51
```

Note how a nominally "strong strategic signal" (70) drops to 51 once evidence weakness and age are both accounted for — this is the point of the composite score: it answers "how much should this matter *right now*," not just "what band did the model originally put it in."

**Database change:** additive columns on `signals`:

```sql
alter table signals
  add column if not exists signal_intent_score int,
  add column if not exists scoring_reason text,
  add column if not exists intelligence_scoring_version text;

alter table signals drop constraint if exists signals_signal_intent_score_check;
alter table signals add constraint signals_signal_intent_score_check check (
  signal_intent_score is null or (signal_intent_score >= 0 and signal_intent_score <= 100)
);
```

**RESOLVED — versioning:** confirmed. `signals.scoring_version` stays exactly as-is (classification methodology, always `"v0.1"` today — untouched by this chunk). A new `signals.intelligence_scoring_version` column versions the Signal Intent Score formula specifically (e.g. `"intel-signal-v1"`). See §5.1 for how this extends to the theme-level scores, which get their own, separately-versioned column rather than sharing this one — momentum and opportunity are a different methodology, computed at a different point in the pipeline, over different inputs (many signals, not one), and need to be able to change independently of the per-signal formula.

**RESOLVED — computation point:** `signal_intent_score`, `scoring_reason`, and `intelligence_scoring_version` are computed **once, when the signal is first stored** — as part of the same `runResearch.ts` step that already inserts each `ResearchFinding` into `signals`, immediately after `researchCompany()` returns. This is a pure arithmetic derivation over fields `researchCompany()` already returns (`confidence_score`, `intent_score`, `published_date`, `confirmed_spend_amount`) — `lib/research.ts` itself (the prompt, the OpenAI call, what gets collected) is not touched. No recompute pass over existing signals. This means the recency component of the formula is evaluated once, at storage time, using `published_date` (or `created_at` if absent) as of that moment — the same way `intent_score`/`confidence_score` are themselves permanent, point-in-time judgments. Trend over time is handled at the aggregate layer instead (§3, §5.1's `theme_score_snapshots`), not by letting individual signal scores drift after the fact — this keeps every stored score reproducible and auditable (a given signal's score never silently changes) and avoids a second, larger database job that would touch every historical row on every run.

## 3. Market Momentum Score

Computed per **theme** (the existing 10-theme taxonomy — see §4 below on why this chunk doesn't introduce a separate "opportunity area" taxonomy), over a trailing 90-day window (matching the recency window already used in research), using only signals with `signal_intent_score` computed (i.e. within the 18-month active window from §2).

**Inputs, each turned into a 0–100 sub-score:**

- **Depth** — average `signal_intent_score` of the theme's qualifying signals in the current window.
- **Breadth** — distinct companies with ≥1 qualifying signal in the theme: `min(100, round(organisations_count / 10 × 100))`. (10 companies showing activity in one theme = full breadth, against a fixed 50-company watchlist — this is a placeholder benchmark, open to adjustment.)
- **Diversity** — distinct `signal_type` values present in the theme this window, out of the 5 canonical types: `round(distinct_signal_types / 5 × 100)`.
- **Velocity** — current-window signal count vs. the immediately preceding 90-day window (91–180 days ago):
  ```
  if prior_window_count == 0 and current_window_count > 0: velocity = 100   // new activity, no baseline
  if prior_window_count == 0 and current_window_count == 0: velocity = 50  // flat/no data
  else: velocity = clamp(50 + round((current_window_count − prior_window_count) / prior_window_count × 100), 0, 100)
  ```

**Composite:**

```
momentum_score = round(0.35×depth + 0.25×breadth + 0.20×diversity + 0.20×velocity)
```

Weights are placeholders (the spec explicitly leaves the formula open) — depth weighted highest since "how strong are the underlying signals" is the closest analogue to intent stage's primacy at the signal level.

**Worked example — hypothetical theme "AI & Automation," current 90-day window:**

| Signal | Company | signal_intent_score | signal_type |
|---|---|---|---|
| 1 | Disney | 83 | projects_launches |
| 2 | Netflix | 74 | hiring |
| 3 | BBC Studios | 51 | strategy |
| 4 | WBD | 88 | procurement |

- Depth = avg(83, 74, 51, 88) = 74
- Breadth = 4 distinct companies → `min(100, round(4/10×100))` = 40
- Diversity = 4 distinct signal_types (projects_launches, hiring, strategy, procurement) / 5 → 80
- Velocity: prior window had 2 signals, current has 4 → `50 + round((4−2)/2×100)` = `50 + 100` = clamp to 100
- momentum_score = round(0.35×74 + 0.25×40 + 0.20×80 + 0.20×100) = round(25.9 + 10 + 16 + 20) = round(71.9) = **72**

`scoring_reason` for the theme row, code-generated: *"4 signals across 4 companies, avg intent 74, all 4 signal dimensions represented, activity roughly doubled vs. the prior 90 days."*

## 4. Opportunity Score (generic, v1 — not personalised)

Also computed per theme (see below for why "theme" is the proposed unit rather than a new "opportunity area" concept), answering: *"how attractive is this technology area for a media technology supplier, generically?"*

**Inputs, each a 0–100 sub-score, current 90-day window:**

- **Market momentum** — reuse `momentum_score` from §3 directly.
- **Investment evidence** — share of the theme's signals that are both high-confidence and high-intent: `round(100 × count(confidence_score ≥ 75 and intent_score ≥ 80) / signals_count)`.
- **Adoption shift** — is the theme moving from experimentation toward real spend? Split the 5 signal types into "adoption-leaning" (`expenditure`, `procurement`, `projects_launches`) vs. "experimentation-leaning" (`strategy`, `hiring`), and compare the adoption-leaning share now vs. the prior 90-day window:
  ```
  adoption_ratio(window) = count(signal_type in adoption-leaning) / signals_count(window)
  adoption_shift = clamp(round(50 + 100 × (adoption_ratio(current) − adoption_ratio(prior))), 0, 100)
  ```
  (50 = no change; above 50 = shifting toward adoption; below 50 = shifting back toward early-stage.)

**Composite:**

```
opportunity_score = round(0.5×momentum_score + 0.3×investment_evidence + 0.2×adoption_shift)

opportunity_strength =
  opportunity_score >= 70 ? "strong"
  : opportunity_score >= 40 ? "emerging"
  : "limited"
```

`opportunity_strength` directly reuses the enum already defined on `signals.opportunity_strength` in the Build Chunk 1 schema (`strong`/`emerging`/`limited`) — same concept, but living on the new theme-level table rather than the per-signal column, since Opportunity Score in this chunk is explicitly market-scoped, not signal-scoped. **The existing `signals.opportunity_strength` and `signals.estimated_opportunity_low/high/currency` columns are a different, still-unbuilt concept (a per-signal dollar estimate) and are not populated by this work** — flagging this explicitly so it's clear this proposal doesn't silently repurpose those fields.

**Worked example, continuing "AI & Automation":** momentum_score = 72 (from §3). Investment evidence: of the 4 signals, 2 meet confidence≥75 and intent≥80 (Disney 83/confidence assumed 88, WBD 88/confidence assumed 92) → `round(100×2/4)` = 50. Adoption shift: current window adoption-leaning signals = 2 of 4 (projects_launches, procurement) = 0.50; prior window (2 signals) had 1 adoption-leaning = 0.50 → no shift → adoption_shift = 50.

```
opportunity_score = round(0.5×72 + 0.3×50 + 0.2×50) = round(36 + 15 + 10) = 61
opportunity_strength = "emerging" (40 ≤ 61 < 70)
```

## 5. Database changes (full summary)

New migration file, `supabase/003_antenna_intelligence_v0.2.sql`, additive only (same pattern as `002_...v0.1.sql` — new nullable columns, two new tables, no drops/renames):

```sql
-- signals: two new columns. scoring_version (classification, v0.1) is
-- untouched — intelligence_scoring_version is new and versions ONLY the
-- Signal Intent Score derivation below.
alter table signals
  add column if not exists signal_intent_score int,
  add column if not exists scoring_reason text,
  add column if not exists intelligence_scoring_version text;

alter table signals drop constraint if exists signals_signal_intent_score_check;
alter table signals add constraint signals_signal_intent_score_check check (
  signal_intent_score is null or (signal_intent_score >= 0 and signal_intent_score <= 100)
);
```

### 5.1 Theme-level tables (RESOLVED — both current-state and history)

Two tables, written together by the same scheduled aggregation step, each versioned independently from `signals.scoring_version` and `signals.intelligence_scoring_version` above — this is the "cleanest database approach" asked for: **one version column per methodology, at the table/grain where that methodology actually lives.** Market Momentum and Opportunity Score are computed together, in the same pass, over the same theme-level dataset, with Opportunity Score directly consuming `momentum_score` as an input (§4) — so they share one version string (`theme_scores.scoring_version` / `theme_score_snapshots.scoring_version`, e.g. `"intel-theme-v1"`) rather than each having a separate one. If momentum and opportunity ever need to change independently of each other, that's a small additive change later (a second version column), consistent with how every other schema change in this project has been made incrementally rather than speculatively.

```sql
-- theme_scores: latest computed value only, one row per theme (upserted
-- on theme, not appended).
create table if not exists theme_scores (
  id bigint generated always as identity primary key,
  theme text not null unique,
  window_days int not null default 90,
  signals_count int not null default 0,
  organisations_count int not null default 0,
  high_intent_signal_count int not null default 0,
  signal_diversity int not null default 0,
  velocity_pct numeric,
  momentum_score int,
  opportunity_score int,
  opportunity_strength text,
  scoring_reason text,
  scoring_version text not null default 'intel-theme-v1',
  computed_at timestamptz not null default now()
);

-- theme_score_snapshots: append-only history, one row per theme per
-- computation run — this is what makes trend direction ("is this theme
-- accelerating?") queryable over time, not just the current value.
create table if not exists theme_score_snapshots (
  id bigint generated always as identity primary key,
  theme text not null,
  window_days int not null default 90,
  signals_count int not null default 0,
  organisations_count int not null default 0,
  high_intent_signal_count int not null default 0,
  signal_diversity int not null default 0,
  velocity_pct numeric,
  momentum_score int,
  opportunity_score int,
  opportunity_strength text,
  scoring_reason text,
  scoring_version text not null default 'intel-theme-v1',
  computed_at timestamptz not null default now()
);

-- same taxonomy/enum constraints applied to both tables:
alter table theme_scores drop constraint if exists theme_scores_theme_check;
alter table theme_scores add constraint theme_scores_theme_check check (
  theme in (
    'AI & Automation', 'Cloud & IP Transformation', 'Streaming & Distribution',
    'Live & Sports Production', 'Content Supply Chain & Workflow',
    'Trust, Security & Provenance', 'Creator & Audience Technology',
    'Advertising & Monetisation', 'Sustainability & Efficiency',
    'Connectivity & Infrastructure'
  )
);
alter table theme_scores drop constraint if exists theme_scores_opportunity_strength_check;
alter table theme_scores add constraint theme_scores_opportunity_strength_check check (
  opportunity_strength is null or opportunity_strength in ('strong', 'emerging', 'limited')
);

alter table theme_score_snapshots drop constraint if exists theme_score_snapshots_theme_check;
alter table theme_score_snapshots add constraint theme_score_snapshots_theme_check check (
  theme in (
    'AI & Automation', 'Cloud & IP Transformation', 'Streaming & Distribution',
    'Live & Sports Production', 'Content Supply Chain & Workflow',
    'Trust, Security & Provenance', 'Creator & Audience Technology',
    'Advertising & Monetisation', 'Sustainability & Efficiency',
    'Connectivity & Infrastructure'
  )
);
alter table theme_score_snapshots drop constraint if exists theme_score_snapshots_opportunity_strength_check;
alter table theme_score_snapshots add constraint theme_score_snapshots_opportunity_strength_check check (
  opportunity_strength is null or opportunity_strength in ('strong', 'emerging', 'limited')
);

create index if not exists theme_scores_theme_idx on theme_scores (theme);
create index if not exists theme_score_snapshots_theme_computed_at_idx
  on theme_score_snapshots (theme, computed_at desc);
```

`theme_scores` answers "what's the current state" (one query, 10 rows, no date logic). `theme_score_snapshots` answers "how has this theme moved over time" (ordered by `computed_at` per theme) — this is what `daily_reports` (already schema-only from Build Chunk 1) can eventually be generated *from*, once report generation is built; this chunk doesn't build that generation step, just the history it would read from.

## 6. Why "theme," not a new "opportunity area" taxonomy

The scoring spec doc talks about "technology opportunity area" somewhat interchangeably with the existing theme concept (the worked example — "AI Production Workflow opportunity" — maps directly onto the existing "AI & Automation" theme). Introducing a *second*, parallel taxonomy for "opportunity areas" distinct from the 10 canonical themes would be a new data dimension not requested anywhere in the brief, and nothing in the source material defines what it would contain beyond the existing themes. Proposal: reuse the existing 10-theme taxonomy as the opportunity-area unit for both Market Momentum and Opportunity Score. Flagging this as an interpretation, not an assumption to skip past — if a genuinely different "opportunity area" grouping is intended (e.g. broader than a single theme, or crossing multiple themes), that needs to be defined before this can be built against it.

## 7. Computation trigger (RESOLVED — two separate triggers, no DB triggers)

Two distinct, application-level (not database-trigger) computation points inside `lib/runResearch.ts`, matching the two different grains at which these scores exist:

1. **Signal Intent Score** — computed inline, per signal, at the point each `ResearchFinding` is about to be inserted into `signals` (right after `researchCompany()` returns for a company, same loop that already does the insert). One signal in, one score out, done once, forever — see §2.
2. **Market Momentum + Opportunity Score** — computed as a **separate, scheduled aggregation step, after the full research run finishes** (after all companies are processed and signals stored, likely alongside or just before the digest-email step). This step queries the *current* `signals` dataset (not a batch just inserted) — it necessarily depends on signals from potentially many different companies and past runs, so it can't run per-signal or per-company; it runs once per full research run, over everything currently in the active window.

Neither is a database trigger (e.g. a Postgres `AFTER INSERT` trigger) — both are plain application code called explicitly from the orchestration in `runResearch.ts`, so the scoring methodology stays in version-controlled, testable TypeScript and can evolve/be versioned the same way the rest of the codebase is, rather than logic living inside the database itself.

This does mean this chunk adds new steps to `runResearch.ts` (orchestration) — not `lib/research.ts` (the research prompt/collection itself, which stays completely untouched, per the brief). Flagging this distinction explicitly since "do not change research collection" is one of the brief's hard constraints and I want to be precise about what "collection" does and doesn't cover here.

## 8. Decisions — status

1. ~~Column naming~~ — **RESOLVED**: `signals.scoring_version` stays as classification versioning; new `signals.intelligence_scoring_version` for Signal Intent Score; new `theme_scores.scoring_version` / `theme_score_snapshots.scoring_version` for the theme-level methodology (momentum + opportunity together). See §2 and §5.1.
2. ~~Computation trigger~~ — **RESOLVED**: Signal Intent Score computed once at signal-creation time, inline in the research pipeline; Market Momentum/Opportunity Score computed as a separate scheduled aggregation step after the run, application-level (no DB triggers). See §7.
3. ~~Theme vs. new "opportunity area" concept~~ — **RESOLVED**: reuse the existing 10-theme taxonomy. Personalised opportunity interpretation is confirmed as a later layer on top of this, not part of v1. See §6.
4. ~~History~~ — **RESOLVED**: both `theme_scores` (current state, upserted) and `theme_score_snapshots` (append-only history) are in scope for this chunk, since trend direction is confirmed as part of the product's value, not deferred to `daily_reports` generation. See §5.1.
5. **Still open — formula weights/thresholds**: the confidence multiplier range, recency curve breakpoints, momentum/opportunity component weights, and the 70/40 strong/emerging/limited thresholds throughout §2–§4 are placeholders reasoned from the source docs, not tuned against real data. Proceeding to implementation with these as a documented first cut unless you want to adjust any of them now — they're straightforward to change later since every formula is centralized in code, not baked into the schema.

All four structural decisions are resolved. No code has been written yet — this document is now the implementation spec. Proceeding to build (migration `003_antenna_intelligence_v0.2.sql` + a new `lib/intelligence.ts` for both scoring functions + the two new steps in `runResearch.ts`) on your go-ahead, still no new UI, still no new data sources, still no changes to `lib/research.ts`.
