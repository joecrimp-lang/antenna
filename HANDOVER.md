# Antenna — Tech Spend Signal Monitor: Technical Handover

Current-state snapshot for planning the next phase. This document is a general overview; for the full Antenna Intelligence Scoring Model v0.1 — canonical taxonomy, exact confidence/intent bands, the exact research prompt, schema details, and the (unimplemented, pending-approval) company/theme aggregation proposals — see **`ANTENNA_SCORING_MODEL.md`**, added in Build Chunk 1.

## Stack

Next.js 14 (App Router, `^14.2.5`), TypeScript, hosted on Vercel (Hobby plan). Supabase (Postgres via `@supabase/supabase-js ^2.45.4`, service-role key, no RLS policies defined). OpenAI Responses API (`openai ^4.90.0`) with the `web_search_preview` tool for research. Resend (`^4.0.0`) for email. No auth library, no queue, no background job system, no analytics.

## Repository structure

```
app/
  page.tsx                        — the (only) dashboard page (public, read-only, no research trigger)
  layout.tsx                      — root layout, sets page title/meta
  globals.css                     — all styling, plain CSS, no framework
  components/RunNowButton.tsx     — client component, NOT rendered anywhere (see Security below)
  api/run-now/route.ts            — POST, operator-only manual trigger (ADMIN_RUN_SECRET)
  api/cron/research/route.ts      — GET, daily cron trigger (CRON_SECRET, fail-closed)
lib/
  supabase.ts                     — Supabase client factory + shared types (Signal, Company, Subscriber, DailyReport, ThemeScore, ThemeScoreSnapshot)
  antennaTaxonomy.ts              — canonical theme/signal_type/opportunity-strength lists + scoring version (single source of truth)
  research.ts                     — OpenAI call + prompt for one company; validation logic now imported from classificationValidation.ts (see below)
  classificationValidation.ts     — Antenna Intelligence v0.1 validation/normalization helpers, extracted from research.ts so the backfill script can reuse them (output-preserving refactor — see file header)
  intelligence.ts                 — Antenna Intelligence Layer v0.2: Signal Intent Score, Market Momentum Score, Opportunity Score (no OpenAI calls — pure derivation over already-classified signals)
  runResearch.ts                  — orchestrates a full run across companies, then the theme-intelligence aggregation step
  email.ts                        — Resend digest email
scripts/
  backfillIntelligence.ts         — one-off, local-only historical backfill (classification + Signal Intent Score for pre-v0.2 signals) — see "Historical backfill" below
supabase/schema.sql                          — original table definitions + seed data (50 companies)
supabase/002_antenna_intelligence_v0.1.sql   — Build Chunk 1 additive migration (classification columns, subscribers, daily_reports)
supabase/003_antenna_intelligence_v0.2.sql   — Intelligence layer additive migration (signal_intent_score + theme_scores/theme_score_snapshots)
.env.example                      — documents required env vars (names only)
vercel.json                       — cron schedule config
README.md                         — detailed running history/decisions log
HANDOVER.md                       — this document
ANTENNA_SCORING_MODEL.md          — Antenna Intelligence Scoring Model reference: v0.1 classification (taxonomy, bands, exact prompt) and v0.2 intelligence layer (§14: Signal Intent/Momentum/Opportunity formulas)
ANTENNA_INTELLIGENCE_LAYER_V0.2_PROPOSAL.md — the intelligence-layer proposal document; kept as the historical decision record
ANTENNA_BACKFILL_PROPOSAL.md      — the historical-backfill proposal document; kept as the historical decision record
package.json / tsconfig.json / next.config.js / next-env.d.ts
```

No auth, no admin UI, no tests, no CI config. This sandbox has no git history for the project (all changes have been delivered as zips with manual apply/commit instructions) — see "Latest deployed commit" below.

## Pages / routes

- `GET /` (`app/page.tsx`) — the only user-facing page. Server-rendered, no auth, **read-only** (as of Build Chunk 1 — no research trigger reachable from here at all). Shows: company count, last run's status/timestamp/counts, up to the newest 100 signals. Forces fresh Supabase reads on every load (`dynamic = "force-dynamic"` + `fetchCache = "force-no-store"`).
- `POST /api/run-now` — **operator-only as of Build Chunk 1.** Requires `Authorization: Bearer <ADMIN_RUN_SECRET>`; fails closed (401) if that env var is unset, in every environment. Synchronously runs the full research pipeline and returns a JSON summary (or a 500 with an error message). `maxDuration = 300` (Vercel Hobby ceiling). No UI calls this anymore — it's callable directly (e.g. via curl) for operator use only.
- `GET /api/cron/research` — same pipeline, triggered daily by Vercel Cron per `vercel.json` (`0 8 * * *`, 08:00 UTC). **Fail-closed as of Build Chunk 1**: on any Vercel deployment (preview or production), a missing `CRON_SECRET` now rejects every request rather than allowing unauthenticated execution; only pure local dev tolerates it being unset.

## Database (Supabase / Postgres)

Seven tables as of the intelligence-layer chunk (three original + two Build Chunk 1 foundation tables + two new intelligence tables), no RLS policies defined (app relies entirely on the service-role key server-side; there is no client-side/browser Supabase usage anywhere).

**`companies`** — the fixed watchlist, seeded once via `schema.sql`, 50 rows. `id`, `rank` (1–50, used for ordering and for the pilot LIMIT/OFFSET mechanism), `name` (unique), `website`, `country`, `created_at`. No UI to edit this list — changes require editing `schema.sql` and re-running SQL directly.

**`signals`** — one row per discovered finding. `id`, `company_id` (FK → companies), `summary`, `detail`, `source_url`, `source_title`, `published_date` (nullable), `created_at`, `emailed_at`. Unique constraint on `(company_id, source_url)` — the entire deduplication mechanism, unchanged. Carries Antenna Intelligence v0.1 classification (Build Chunk 1): `theme`, `signal_type`, `confidence_score` (0–100), `intent_score` (0–100), `scoring_version`, `classification_reason`, `confirmed_spend_amount`, `confirmed_spend_currency`, plus schema-only-for-now `estimated_opportunity_low/high/currency` and `opportunity_strength` (always null — no per-signal-dollar methodology approved yet). **As of the intelligence-layer chunk**, also carries `signal_intent_score` (0–100), `scoring_reason`, and `intelligence_scoring_version` (`"intel-signal-v1"`) — computed once, at signal-creation time, in `lib/runResearch.ts` via `lib/intelligence.ts`; see `ANTENNA_SCORING_MODEL.md` §14. All new columns are nullable and not backfilled onto historical rows.

**`runs`** — one row per research run (manual or cron). `id`, `started_at`, `finished_at`, `status` (`running` / `completed` / `completed_with_errors`), `companies_processed`, `signals_found`, `error`. Unchanged in this chunk.

**`subscribers`** *(Build Chunk 1)* — foundations for the future email-gated report; only `email` required. No capture form or code writes to it yet. See `ANTENNA_SCORING_MODEL.md` §8.

**`daily_reports`** *(Build Chunk 1)* — foundations for an immutable daily report snapshot; `report_date`, `report_data` (jsonb), `status`. No generation job writes to it yet — see `ANTENNA_SCORING_MODEL.md` §9, §14.4 (the new `theme_score_snapshots` table below is intended as this generation step's future input).

**`theme_scores`** *(new, intelligence-layer chunk)* — one row per canonical theme (10 rows, upserted in place — always the latest computed value, never historical). Market Momentum Score, Opportunity Score, and their supporting counts (`signals_count`, `organisations_count`, `high_intent_signal_count`, `signal_diversity`, `velocity_pct`), plus `scoring_reason` and `scoring_version` (`"intel-theme-v1"`). Written by `computeAndStoreThemeScores()` in `lib/intelligence.ts`, called once per research run. See `ANTENNA_SCORING_MODEL.md` §14.2–§14.4.

**`theme_score_snapshots`** *(new, intelligence-layer chunk)* — same shape as `theme_scores`, but append-only: one new row per theme every time the aggregation step runs, so momentum/opportunity trend over time is queryable. Written alongside `theme_scores` by the same computation. No UI reads this yet.

## How a research run works, end-to-end

1. A request hits `/api/run-now` (button click) or `/api/cron/research` (daily schedule) → both call `runFullResearch()` in `lib/runResearch.ts`.
2. Insert a `runs` row with `status: "running"`.
3. Load companies from `companies`, ordered by `rank`, optionally windowed by `RESEARCH_COMPANY_LIMIT` / `RESEARCH_COMPANY_OFFSET` (see below).
4. Process companies in concurrent chunks of `CONCURRENCY` (currently **2**) using `Promise.all` per chunk — the next chunk starts only once the current one fully settles. This is a single synchronous invocation, not a queue or background job; everything must finish inside one Vercel function call.
5. For each company (`researchCompany()` in `lib/research.ts`): one OpenAI Responses API call with the `web_search_preview` tool, a 25-second per-call timeout, `maxRetries: 0`, `max_output_tokens: 2000` (raised from 1200 in Build Chunk 1 alongside the classification fields below — see `ANTENNA_SCORING_MODEL.md` §5). The model returns up to 2 findings as JSON, **each now including Antenna Intelligence v0.1 classification** (theme, signal_type, confidence/intent scores, rationale — same call, no second OpenAI request). Any failure (timeout, API error, malformed JSON) is caught and recorded as a per-company error — it does not fail the run or the rest of that chunk.
6. Immediately before each finding is inserted, its Signal Intent Score is computed (`computeSignalIntentScore()` in `lib/intelligence.ts` — pure arithmetic over the fields already returned by `researchCompany()`, no OpenAI call) and included in the same insert. Each finding is inserted into `signals`, including its v0.1 classification fields (`scoring_version` set by code, not the model) and its v0.2 intelligence fields (`signal_intent_score`, `scoring_reason`, `intelligence_scoring_version`); a duplicate `(company_id, source_url)` is silently skipped (not an error, not counted as found). A finding with unparseable/invalid classification is still stored, with those fields (and, consequently, the intelligence fields) left `null` — classification failure never blocks storage of the underlying signal.
7. After every company is processed: `computeAndStoreThemeScores()` (`lib/intelligence.ts`) recomputes Market Momentum + Opportunity Score for all 10 themes from the current `signals` dataset, upserts `theme_scores`, and appends a row to `theme_score_snapshots`. Wrapped in try/catch — a failure here is recorded as a run error but never blocks the digest step below.
8. Query every `signals` row with `emailed_at is null`, send one digest email via Resend if there are any, and only mark them `emailed_at` if the send is confirmed successful (fixed recently — see "Known issues").
9. Update the `runs` row: `finished_at`, `status` (`completed` if no errors accumulated, else `completed_with_errors`), `companies_processed`, `signals_found`, and the joined error text.
10. Return a JSON summary (`companiesProcessed`, `signalsFound`, `emailed`, `errors[]`) to the caller — unchanged shape; the intelligence layer doesn't add anything to this response (no UI consumes it yet).

## Scoring / classification logic

**As of Build Chunk 1, each signal carries per-signal Antenna Intelligence v0.1 classification** — a canonical `theme` (1 of 10), a canonical `signal_type` (1 of 5 Intent dimensions), a `confidence_score` (0–100), an `intent_score` (0–100), and a `classification_reason` explaining both. This happens in the same OpenAI call that finds the signal (no second/extra web-search request), validated and normalized server-side before storage. **There is still no company-level or theme-level roll-up score** — that requires an aggregation methodology that has been proposed but not approved (see `ANTENNA_SCORING_MODEL.md` §11–§12). There is also no Opportunity scoring of any kind yet (numeric or qualitative) — the schema has room for it, nothing populates it.

Full detail — exact confidence/intent bands, the complete current prompt, validation rules, known weaknesses, and the pending methodology proposals — lives in **`ANTENNA_SCORING_MODEL.md`**, not duplicated here to avoid the two documents drifting out of sync.

Model: `gpt-5.6-luna` by default (overridable via `OPENAI_MODEL`) — chosen for cost after the flagship tier (`gpt-5.6`, "Sol") proved too slow/expensive; no weighting between model tiers, it's a single flat choice; not separately validated for classification-quality against a stronger model. There is also a hard code-level cap (`.slice(0, 2)`) enforcing the 2-finding limit regardless of what the model returns.

## Historical backfill

Two chunks in (Build Chunk 1 adding classification, then the intelligence layer adding `signal_intent_score`), older signals are missing fields that only exist going forward — the live pipeline never recomputes historical rows. `scripts/backfillIntelligence.ts` is a **one-off, local-only script** (not deployed, not on a cron, no new API route) that fills these in. Full proposal/decision record: `ANTENNA_BACKFILL_PROPOSAL.md`.

**Two groups, handled differently:**
- **Group A** (`theme is null` — predates Build Chunk 1 entirely): needs an OpenAI classification-only call (no web search — the finding is already recorded, it just needs classifying) using a prompt that reproduces `lib/research.ts`'s classification instructions **verbatim but duplicated**, not shared (see that script's header comment for why — briefly, restructuring `research.ts`'s prompt construction to share the text carried more risk of subtly changing the live, already-carefully-tuned prompt than duplicating ~40 lines of prose once). If `research.ts`'s classification wording changes again, this copy needs updating by hand.
- **Group B** (`theme is not null and signal_intent_score is null` — classified under Build Chunk 1, predates the intelligence layer): Signal Intent Score only, computed via the exact same `computeSignalIntentScore()` the live pipeline uses (imported, not duplicated) — no OpenAI call, no cost.

The validation/normalization logic Group A needs (matching theme/signal_type against the canonical taxonomy, clamping scores, etc.) **is shared, not duplicated** — it was extracted from `research.ts` into `lib/classificationValidation.ts` as a pure, output-preserving refactor (moved function bodies, `research.ts` now imports them; the live prompt/model/timeout/token-cap were not touched). Both `research.ts` and the backfill script call the identical functions, so there's no risk of the two ever validating differently.

After both groups finish, the script calls `computeAndStoreThemeScores()` (the same function the daily pipeline calls) once, so `theme_scores`/`theme_score_snapshots` reflect the now-larger classified corpus — this does add one extra snapshot row set outside the normal daily cadence, which is expected (the corpus materially changed).

**Run it:**
```
set -a; source .env.local; set +a
npx tsx scripts/backfillIntelligence.ts --dry-run   # counts + cost estimate, no writes
npx tsx scripts/backfillIntelligence.ts             # the real thing
```
`--limit=N` / `--offset=N` cap/skip rows per group, for testing on a small slice first. Safe to re-run — every query filters on current null-state, so anything already backfilled is skipped automatically; if interrupted, just run it again. Prints per-row progress and a final summary (rows processed/classified/scored/failed per group, OpenAI token usage, an estimated cost, and every error).

**Not yet run as of this writing** — this environment has no live database or OpenAI access, so it's been verified by type-checking and a full runtime pass against stubbed Supabase/OpenAI clients (confirmed: Group A classification → validation → Signal Intent Score → update; Group B scoring; theme recalculation — all execute correctly), not against production data. Run it once, review the summary, and keep it around in case new historical gaps ever appear (e.g. from a future methodology version bump).

## How companies are selected for each run

Every run processes **all 50 companies, ordered by `rank`**, unless overridden by two optional env vars used for cost-controlled pilots:

- `RESEARCH_COMPANY_LIMIT` — caps how many companies are processed.
- `RESEARCH_COMPANY_OFFSET` — skips this many companies (in rank order) before the limit applies, e.g. `LIMIT=5` + `OFFSET=5` processes companies ranked 6–10.

Both are unset in normal operation (full 50-company runs). There's no other selection logic — no "only companies with no recent signal," no rotation, no prioritization by importance.

## Resend / email

`lib/email.ts` sends **one digest email per run** (only if there's at least one unsent signal), to a single hardcoded recipient (`DIGEST_EMAIL_TO`) — there is no concept of multiple recipients, subscriber lists, or per-user email in the current code. The email is a simple HTML table: company name, summary, detail, a clickable source link, and published date per row.

Recently fixed: the Resend SDK does not throw on API-level failures (invalid recipient, unverified sending domain, etc.) — it resolves with `{ data, error }`, and the code previously ignored that result entirely, so a rejected send looked identical to success and signals still got marked `emailed_at`. This is now fixed: the code checks `error` and throws, which is caught by the existing per-run error handling (recorded in `runs.error`, run marked `completed_with_errors`) and — critically — `emailed_at` is now only set after a confirmed successful send. Any signal rows marked `emailed_at` from *before* this fix may have been incorrectly marked despite the email never actually sending; worth cross-checking against the Resend dashboard's send history if historical delivery accuracy matters.

## Environment variables (names only)

```
NEXT_PUBLIC_SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
OPENAI_API_KEY
OPENAI_MODEL                  (optional, defaults to gpt-5.6-luna)
RESEARCH_COMPANY_LIMIT        (optional, pilot use)
RESEARCH_COMPANY_OFFSET       (optional, pilot use)
RESEND_API_KEY
RESEND_FROM_EMAIL
DIGEST_EMAIL_TO
CRON_SECRET                   (effectively required on any Vercel deployment as of Build Chunk 1 — fails closed if unset there; optional only for pure local dev)
ADMIN_RUN_SECRET              (new, Build Chunk 1 — required, protects POST /api/run-now)
```

## Known issues / open risks

- **Operator endpoints are now protected, but there's still no real auth model.** `ADMIN_RUN_SECRET` and `CRON_SECRET` are shared secrets in env vars, not a login/session system — fine for the current single-operator stage, but this is not what a multi-person team or public-facing operator surface would eventually need.
- **Timeout margin is thin at the current concurrency.** `CONCURRENCY` was reduced from 5 to 2 to stay under Luna's TPM rate limit. At `CONCURRENCY = 2`, a full 50-company run is 25 sequential chunks; at the 25-second per-company timeout, the worst case (every single company timing out) is 625 seconds — well past Vercel's 300-second Hobby limit. In practice most calls finish in well under 25s, so this hasn't caused an observed failure, but there's no real safety margin left the way there was at concurrency 5. (The two stale "concurrent groups of 5" code comments noted previously were removed as a side effect of the Build Chunk 1 route changes.)
- **Dashboard was serving stale cached data** — diagnosed as Next.js's Data Cache caching the underlying Supabase fetches even though the route itself was set to render dynamically. Fixed by adding `fetchCache = "force-no-store"` to `app/page.tsx`. This fix has been delivered but I have no direct visibility into the live Vercel deployment from this environment — worth explicitly confirming it's actually deployed before relying on the dashboard for anything.
- **No "detected date" shown on the dashboard yet.** Signal cards currently show the source's `published_date` (often null, since the model doesn't always find one) but not `created_at` (when Antenna actually found/stored it). Identified earlier as a small gap, not yet implemented. Unaffected by Build Chunk 1.
- **No overlapping-run protection.** Nothing stops two runs (e.g. cron firing while an operator's manual run is in progress) from executing concurrently and independently.
- **No retry logic anywhere** — a deliberate MVP choice, not an oversight, but worth knowing before assuming failed companies get a second attempt.
- **The intelligence layer's formula weights/thresholds are v0.2 heuristics, not validated truths.** The confidence multiplier range, recency curve breakpoints, momentum/opportunity component weights, the 10-company breadth benchmark, and the 70/40 strong/emerging/limited thresholds (`lib/intelligence.ts`, documented in `ANTENNA_SCORING_MODEL.md` §14.5) were reasoned from the source spec docs, not tuned against real production signal volume or checked against how a human analyst with real market judgement would actually rank these signals/themes — that validation hasn't happened yet and should before these scores drive anything customer-facing. Every formula is centralized in code, not the schema, so adjusting any of these later is a code change, not a migration.
- **Signal Intent Score is not backfilled onto pre-v0.2 signals** — historical rows have `null` `signal_intent_score` and are excluded from theme aggregation until/unless a separate, explicitly-approved backfill migration is written.
- **No UI reads `theme_scores`/`theme_score_snapshots` yet** — per explicit scope, this chunk is intelligence-layer-only. The data is queryable directly in Supabase but nothing in the app surfaces it.
- **Classification quality is unverified.** Confidence/Intent scores are the model's self-assessment against the written bands — there's no independent check, spot-check process, or evaluation harness confirming the model applies the bands consistently across companies or over time. Worth planning for before this scoring feeds anything customer-facing.
- **No company-level or theme-level scores exist yet**, and the formulas to produce them are proposed but explicitly not approved or implemented — see `ANTENNA_SCORING_MODEL.md` §11–§12. Nothing currently aggregates individual signal scores into anything higher-level.
- **First production run after Build Chunk 1 timed out on 4 companies** (classification prompt made the per-company OpenAI call too slow for the fixed 25s timeout) — fixed by condensing the classification prompt (see "Timeout regression" in `README.md` and `ANTENNA_SCORING_MODEL.md` §5). Not yet re-validated with a live run. **You still need to check the Vercel `RESEARCH_COMPANY_OFFSET` env var and clear it if it's set to `5`** — it looks like a stale leftover from an earlier pilot and would silently keep skipping the first 5 companies even after the prompt fix.
- **This sandbox has no git access to the live repository.** Every change across this whole build has been delivered as a zip with manual `git add`/`commit`/`push` instructions for you to run. I cannot independently verify what's actually deployed at any given time — see "Latest deployed commit" below, and the Validation section of the Build Chunk 1 implementation report for what this means for confirming these specific changes are live.

## Latest deployed commit

I cannot determine this from here — this working environment has no connection to your GitHub repository or Vercel project (no git remote configured, no deploy access). To get the true answer: run `git log -1` in your local clone, or check the "Deployments" tab in the Vercel dashboard, which shows the exact commit SHA behind the current production deployment. Given the manual zip-apply workflow used throughout this build, I'd treat confirming this — and confirming it matches what you expect — as a first step before planning further work, not an assumption to skip.

## Before adding a public landing page, email capture/unlock flow, and a new dashboard

A few things that will need real design decisions, not small patches, because the current app was built around a single trusted operator, not public users:

- **A `subscribers` table now exists (Build Chunk 1), but nothing uses it yet.** `DIGEST_EMAIL_TO` is still one hardcoded address for the operator digest — the new table is schema only. An email-capture flow still needs a signup path/form, and `sendDigestEmail` (or a new function) still needs to be built out to send to N subscribers rather than one hardcoded address — the table existing removes the schema work, not the feature work.
- **No gating/tier concept exists in the data model.** Signals have no visibility flag, no "preview vs full" state, no per-user unlock status. A teaser-then-unlock product pattern needs new schema and new logic to decide what a non-unlocked visitor sees (e.g. redacted company name, 1 of 2 findings, etc.) — none of that exists today. (Per-signal Antenna Intelligence scores now exist as of Build Chunk 1, which is likely useful *content* for a teaser — e.g. showing a theme/confidence badge without the full detail — but the gating mechanism itself is still unbuilt.)
- **Data access is currently all-or-nothing.** The dashboard queries Supabase directly with the service-role key from a trusted server context and returns everything. If a new dashboard is meant to show different data to different (possibly anonymous, possibly unlocked) visitors, that access pattern needs to be redesigned, not layered with a login screen on top.
- **`/api/run-now` is now protected (Build Chunk 1)** — requires `ADMIN_RUN_SECRET`, fails closed if unset. A public landing page still must not surface or link to this endpoint; it's operator-only, not public-safe-by-design.
- **`daily_reports` now exists as a snapshot table (Build Chunk 1), but nothing generates reports into it yet.** That requires the company/theme aggregation methodology, which is proposed but not approved — see `ANTENNA_SCORING_MODEL.md` §11–§12. A new dashboard/report experience is blocked on that decision, not just on frontend work.
- **Timeout/traffic profile mismatch.** The current architecture (one synchronous request does all the work, 300s Vercel ceiling, thin margin as noted above) was designed around a single manual trigger or a daily cron — not public web traffic. This isn't directly affected by adding a landing page (research runs stay server-triggered either way), but it's worth reassessing hosting/plan needs once there's real public traffic hitting the site generally.
- **No analytics/telemetry exists anywhere** — conversion tracking for a landing page / email capture flow would be entirely new instrumentation.
- **No privacy policy, consent language, or unsubscribe mechanism** exists in the current Resend integration — needed before collecting emails from the public, independent of any specific jurisdiction's requirements. `subscribers.is_suppressed` gives a future unsubscribe flow somewhere to write to, but nothing implements that flow yet.
