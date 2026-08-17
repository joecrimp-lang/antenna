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
  supabase.ts                     — Supabase client factory + shared types (Signal, Company, Subscriber, DailyReport)
  antennaTaxonomy.ts              — canonical theme/signal_type/opportunity-strength lists + scoring version (single source of truth)
  research.ts                     — OpenAI call + prompt + Antenna Intelligence classification/validation for one company
  runResearch.ts                  — orchestrates a full run across companies
  email.ts                        — Resend digest email
supabase/schema.sql                          — original table definitions + seed data (50 companies)
supabase/002_antenna_intelligence_v0.1.sql   — Build Chunk 1 additive migration (classification columns, subscribers, daily_reports)
.env.example                      — documents required env vars (names only)
vercel.json                       — cron schedule config
README.md                         — detailed running history/decisions log
HANDOVER.md                       — this document
ANTENNA_SCORING_MODEL.md          — Antenna Intelligence Scoring Model v0.1 reference (taxonomy, bands, exact prompt, methodology proposals)
package.json / tsconfig.json / next.config.js / next-env.d.ts
```

No auth, no admin UI, no tests, no CI config. This sandbox has no git history for the project (all changes have been delivered as zips with manual apply/commit instructions) — see "Latest deployed commit" below.

## Pages / routes

- `GET /` (`app/page.tsx`) — the only user-facing page. Server-rendered, no auth, **read-only** (as of Build Chunk 1 — no research trigger reachable from here at all). Shows: company count, last run's status/timestamp/counts, up to the newest 100 signals. Forces fresh Supabase reads on every load (`dynamic = "force-dynamic"` + `fetchCache = "force-no-store"`).
- `POST /api/run-now` — **operator-only as of Build Chunk 1.** Requires `Authorization: Bearer <ADMIN_RUN_SECRET>`; fails closed (401) if that env var is unset, in every environment. Synchronously runs the full research pipeline and returns a JSON summary (or a 500 with an error message). `maxDuration = 300` (Vercel Hobby ceiling). No UI calls this anymore — it's callable directly (e.g. via curl) for operator use only.
- `GET /api/cron/research` — same pipeline, triggered daily by Vercel Cron per `vercel.json` (`0 8 * * *`, 08:00 UTC). **Fail-closed as of Build Chunk 1**: on any Vercel deployment (preview or production), a missing `CRON_SECRET` now rejects every request rather than allowing unauthenticated execution; only pure local dev tolerates it being unset.

## Database (Supabase / Postgres)

Five tables as of Build Chunk 1 (three original + two new foundation tables), no RLS policies defined (app relies entirely on the service-role key server-side; there is no client-side/browser Supabase usage anywhere).

**`companies`** — the fixed watchlist, seeded once via `schema.sql`, 50 rows. `id`, `rank` (1–50, used for ordering and for the pilot LIMIT/OFFSET mechanism), `name` (unique), `website`, `country`, `created_at`. No UI to edit this list — changes require editing `schema.sql` and re-running SQL directly.

**`signals`** — one row per discovered finding. `id`, `company_id` (FK → companies), `summary`, `detail`, `source_url`, `source_title`, `published_date` (nullable), `created_at`, `emailed_at`. Unique constraint on `(company_id, source_url)` — the entire deduplication mechanism, unchanged. **As of Build Chunk 1**, also carries Antenna Intelligence v0.1 classification: `theme`, `signal_type`, `confidence_score` (0–100), `intent_score` (0–100), `scoring_version`, `classification_reason`, `confirmed_spend_amount`, `confirmed_spend_currency`, plus schema-only-for-now `estimated_opportunity_low/high/currency` and `opportunity_strength` (always null — no methodology approved yet). All new columns are nullable; historical rows are unaffected. See `ANTENNA_SCORING_MODEL.md` for exact meaning/validation.

**`runs`** — one row per research run (manual or cron). `id`, `started_at`, `finished_at`, `status` (`running` / `completed` / `completed_with_errors`), `companies_processed`, `signals_found`, `error`. Unchanged in this chunk.

**`subscribers`** *(new, Build Chunk 1)* — foundations for the future email-gated report; only `email` required. No capture form or code writes to it yet. See `ANTENNA_SCORING_MODEL.md` §8.

**`daily_reports`** *(new, Build Chunk 1)* — foundations for an immutable daily report snapshot; `report_date`, `report_data` (jsonb), `status`. No generation job writes to it yet — the company/theme aggregation methodology it would depend on is proposed but not approved. See `ANTENNA_SCORING_MODEL.md` §9, §11, §12.

## How a research run works, end-to-end

1. A request hits `/api/run-now` (button click) or `/api/cron/research` (daily schedule) → both call `runFullResearch()` in `lib/runResearch.ts`.
2. Insert a `runs` row with `status: "running"`.
3. Load companies from `companies`, ordered by `rank`, optionally windowed by `RESEARCH_COMPANY_LIMIT` / `RESEARCH_COMPANY_OFFSET` (see below).
4. Process companies in concurrent chunks of `CONCURRENCY` (currently **2**) using `Promise.all` per chunk — the next chunk starts only once the current one fully settles. This is a single synchronous invocation, not a queue or background job; everything must finish inside one Vercel function call.
5. For each company (`researchCompany()` in `lib/research.ts`): one OpenAI Responses API call with the `web_search_preview` tool, a 25-second per-call timeout, `maxRetries: 0`, `max_output_tokens: 2000` (raised from 1200 in Build Chunk 1 alongside the classification fields below — see `ANTENNA_SCORING_MODEL.md` §5). The model returns up to 2 findings as JSON, **each now including Antenna Intelligence v0.1 classification** (theme, signal_type, confidence/intent scores, rationale — same call, no second OpenAI request). Any failure (timeout, API error, malformed JSON) is caught and recorded as a per-company error — it does not fail the run or the rest of that chunk.
6. Each finding is inserted into `signals`, including its classification fields (`scoring_version` set by code, not the model); a duplicate `(company_id, source_url)` is silently skipped (not an error, not counted as found). A finding with unparseable/invalid classification is still stored, with those fields left `null` — classification failure never blocks storage of the underlying signal.
7. After all companies are processed: query every `signals` row with `emailed_at is null`, send one digest email via Resend if there are any, and only mark them `emailed_at` if the send is confirmed successful (fixed recently — see "Known issues").
8. Update the `runs` row: `finished_at`, `status` (`completed` if no errors accumulated, else `completed_with_errors`), `companies_processed`, `signals_found`, and the joined error text.
9. Return a JSON summary (`companiesProcessed`, `signalsFound`, `emailed`, `errors[]`) to the caller.

## Scoring / classification logic

**As of Build Chunk 1, each signal carries per-signal Antenna Intelligence v0.1 classification** — a canonical `theme` (1 of 10), a canonical `signal_type` (1 of 5 Intent dimensions), a `confidence_score` (0–100), an `intent_score` (0–100), and a `classification_reason` explaining both. This happens in the same OpenAI call that finds the signal (no second/extra web-search request), validated and normalized server-side before storage. **There is still no company-level or theme-level roll-up score** — that requires an aggregation methodology that has been proposed but not approved (see `ANTENNA_SCORING_MODEL.md` §11–§12). There is also no Opportunity scoring of any kind yet (numeric or qualitative) — the schema has room for it, nothing populates it.

Full detail — exact confidence/intent bands, the complete current prompt, validation rules, known weaknesses, and the pending methodology proposals — lives in **`ANTENNA_SCORING_MODEL.md`**, not duplicated here to avoid the two documents drifting out of sync.

Model: `gpt-5.6-luna` by default (overridable via `OPENAI_MODEL`) — chosen for cost after the flagship tier (`gpt-5.6`, "Sol") proved too slow/expensive; no weighting between model tiers, it's a single flat choice; not separately validated for classification-quality against a stronger model. There is also a hard code-level cap (`.slice(0, 2)`) enforcing the 2-finding limit regardless of what the model returns.

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
