# Tech Spend Signal Monitor (MVP)

Watches a fixed list of 50 media & entertainment companies for public
signals that suggest future technology spending (capex/budget statements,
AI/cloud initiatives, vendor deals, tech hiring pushes, RFPs, tech
acquisitions, etc). Runs once a day, stores findings in Supabase, and emails
a digest of anything new via Resend.

This is intentionally crude: one dashboard page, one cron job, no auth, no
user accounts, no editing of the company list from the UI.

## How it works

1. Vercel Cron hits `/api/cron/research` once a day (or you trigger a run
   manually from the dashboard's "Run now" button).
2. That request creates one row in the `runs` table, then processes all 50
   companies (or fewer — see `RESEARCH_COMPANY_LIMIT` below) **within that
   same request**, in concurrent groups of `CONCURRENCY` (2) rather than one
   at a time or split across separate background invocations — see
   "Batching history" below for why. For each company, it asks OpenAI
   (Responses API, with the `web_search_preview` tool) to search the web and
   return at most 2 new, sourced signals of future tech spending as JSON,
   capped at 1200 output tokens per company.
3. New signals are stored in Supabase (`signals` table); duplicates (same
   company + source URL) are skipped automatically. One company failing
   (OpenAI error, bad response, etc.) doesn't stop the others in its group
   or any later group — its error is recorded on the run and processing
   continues.
4. Once every company is done, any signal that hasn't been emailed yet gets
   sent in one digest email via Resend, then marked as emailed. The run row
   is marked `completed` or `completed_with_errors`.
5. The dashboard (`/`) shows the most recent 100 signals, the latest run's
   status, and a "Run now" button. Clicking it waits for the whole run to
   finish (this can take a couple of minutes) and then shows the real
   result — how many companies were processed and how many new signals were
   found.

### Batching history (why it's a single request, not chained batches)

An earlier version of this app split the watchlist across multiple
short-lived invocations, chained via Vercel's `waitUntil()` background
mechanism, specifically to stay under Vercel's 300-second function timeout.
In practice, `waitUntil()`-based background continuation proved unreliable
here — runs got created but the actual background work never progressed
(Vercel's Hobby-tier background execution model doesn't reliably keep an
invocation alive for substantial work like sequential API calls; it's
documented as suitable only for trivial things like analytics pings). Hobby
Cron also can't fire more than once a day, so there was no reliable way to
drive multiple invocations for the unattended daily run either.

The current design processes companies **concurrently** (`CONCURRENCY` at a
time, currently 2 — see "Recall tuning" and the known-limitations note
below for why this was reduced from an initial 5) instead of
**sequentially**, which is what actually solves the timeout risk in
practice: 50 companies at N-way concurrency is roughly 50/N sequential
"rounds," each bounded by its slowest member rather than the sum of N.
Each individual OpenAI call is also capped at 25s
(`PER_COMPANY_TIMEOUT_MS` in `lib/research.ts`, `maxRetries: 0` so the SDK
doesn't quietly retry past that budget), so the worst case is a real
ceiling rather than an open-ended risk: (50/N) rounds × 25s for the
research itself, plus a few seconds of Supabase/Resend overhead. At the
original `CONCURRENCY = 5` that ceiling was comfortably inside Vercel's
300s limit (250s) even if every company timed out; at the current
`CONCURRENCY = 2` it is not (625s worst case) — see the known-limitations
note below. A timeout is treated as an ordinary per-company failure
(recorded on the run, processing continues), not a retry or a failure of
the whole run. This is simpler and more reliable than the earlier
chained-batches approach, since it relies only on an ordinary
`await`-driven function call completing, not on best-effort background
execution.

## Setup

### 1. Supabase

1. Create a new Supabase project.
2. Open the SQL editor and run `supabase/schema.sql`. This creates the
   `companies`, `signals`, and `runs` tables and seeds the 50-company
   watchlist.
   - If your `runs` table has a leftover `cursor` column from an earlier
     version of this app, it's no longer used — it's harmless to leave in
     place, no migration needed to remove it.
3. From Project Settings → API, grab the **Project URL** and the
   **service_role key** (not the anon key — this app runs entirely
   server-side with no row-level security).

### 2. OpenAI

1. Grab an API key with access to the Responses API and the
   `web_search_preview` tool.
2. `OPENAI_MODEL` defaults to `gpt-5.6-luna` in `.env.example` — the
   cheapest/fastest tier in the GPT-5.6 family, chosen after an early run on
   the flagship `gpt-5.6` ("Sol") tier turned out too slow and expensive for
   this MVP (see "Cost" below). Check your OpenAI account for which models
   currently support web search and set this env var if you need a
   different one.
3. This uses the OpenAI Responses API (`client.responses.create` with a
   `web_search_preview` tool) via the `openai` npm package (pinned to
   `^4.90.0`). The tool type name has changed before (this project
   originally used `web_search`, which the installed SDK version rejected
   at build time) and may change again — if `npm run build` fails on the
   `tools` array, check the current API reference at
   https://developers.openai.com/api/docs/guides/tools-web-search and the
   installed SDK's TypeScript types for the accepted value.
4. Each research call is capped at `max_output_tokens: 1200` and the prompt
   asks for at most 2 findings per company (also enforced in code as a
   belt-and-suspenders `slice(0, 2)` in `lib/research.ts`), to keep both
   cost and latency down per company. Raised from an initial 500 after a
   5-company pilot showed the lower cap was likely truncating the model's
   output before it could finish searching and respond — see "Recall tuning"
   below.
5. The prompt asks the model to search over the last 90 days (widened from
   an initial 30) and explicitly calls out new internal AI/technology teams,
   labs, studios, or platform launches (and related hiring) as a signal
   category, alongside company press/IR pages and relevant trade press
   (Variety, Deadline, Broadcast, Digital TV Europe, The Hollywood
   Reporter) — added for the same reason.

#### Recall tuning

A 5-company pilot on companies ranked 6-10 (Luna, the original 500-token
cap, 30-day window) returned zero stored signals, despite independent
research finding real, publicly reported signals for at least two of those
companies (an AI-native production platform under active hiring, and a
newly launched AI creative lab). The most likely cause: `max_output_tokens`
capped the *entire* Responses API turn, including the model's web-search
tool use, not just the final JSON — for a fast/cheap model like Luna,
narrower or less obvious signals could exhaust that budget before the model
finished searching and writing a response, which fails silently (the code
treats malformed/truncated output as "found nothing," not an error). The
token cap increase and the added signal category / trade-press guidance
above are meant to address that; the 90-day window is a smaller hedge
against real signals being excluded on recency alone. This hasn't yet been
re-validated with another pilot — do that next (`RESEARCH_COMPANY_LIMIT=5`,
`RESEARCH_COMPANY_OFFSET=5`) before assuming it's fixed.

#### Cost

OpenAI's published per-1M-token pricing for the GPT-5.6 family (input /
output) is: Sol (flagship) $5 / $30, Terra (mid) $2.50 / $15, Luna
(fast/cheap) $1 / $6. Web search tool calls are billed separately, roughly
flat per call. This MVP defaults to Luna specifically to minimize cost, but
the actual dollar cost of a full 50-company run hasn't been measured yet —
an early run on Sol exhausted a $10 balance before finishing 50 companies
(partly due to timeouts and rate limits, not just per-token price), and
there isn't yet a reliable per-run cost figure for Luna with the tightened
prompt/output caps in this version. Use `RESEARCH_COMPANY_LIMIT` (and
optionally `RESEARCH_COMPANY_OFFSET`, both below) to run a small pilot (e.g.
5 companies) and check actual token usage / billing before scaling back up
to all 50.

### 3. Resend

1. Create a Resend account and verify a sending domain (or use their test
   domain while trying things out).
2. Grab an API key and set `RESEND_FROM_EMAIL` to a verified sender address.

### 4. Environment variables

Copy `.env.example` to `.env.local` for local dev, and set the same values
in your Vercel project's Environment Variables for production:

- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY`
- `OPENAI_MODEL` (optional)
- `RESEARCH_COMPANY_LIMIT` (optional) — caps how many companies a run
  processes, e.g. set to `5` to pilot on a subset of the watchlist and check
  real cost/behavior before running the full 50. Unset means no limit (all
  companies, ordered by `rank`).
- `RESEARCH_COMPANY_OFFSET` (optional) — skips this many companies (in rank
  order) before the limit above is applied, so you can pilot on a different
  slice of the watchlist. E.g. `RESEARCH_COMPANY_LIMIT=5` with
  `RESEARCH_COMPANY_OFFSET=5` processes the companies ranked 6-10. Unset
  means start from the beginning of the watchlist (rank 1).
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`
- `DIGEST_EMAIL_TO` — defaults to `joe.crimp@gmail.com` if unset, but set it
  explicitly
- `CRON_SECRET` — generate with `openssl rand -hex 32`. Vercel automatically
  sends this as a bearer token to your cron route once it's set as an env
  var, which is what authenticates the daily job.

### 5. Deploy

1. Push this repo to GitHub and import it into Vercel, or run `vercel` from
   this directory.
2. Add the environment variables above in the Vercel project settings.
3. The `vercel.json` cron (`0 8 * * *`, i.e. daily at 08:00 UTC) is picked
   up automatically on deploy.
4. Visit the deployed URL, click "Run now" once to confirm everything is
   wired up correctly. It'll take a minute or two (50 companies at 5-way
   concurrency) and then show the real result — companies processed and new
   signals found.

## Notes / known limitations (by design, for an MVP)

- No authentication on the dashboard or the `/api/run-now` endpoint. Anyone
  with the URL can view signals or trigger a run (which costs OpenAI
  usage). Fine for a private tool; add auth before sharing the URL widely.
- The 50-company list is fixed via the seed SQL. To change it, edit
  `supabase/schema.sql` and update the `companies` table directly.
- No retry/backoff logic — if OpenAI or Resend has a transient failure for
  one company, that company's error is recorded on the `runs` row and
  processing continues with the rest.
- Digest emails aren't batched by frequency — every unsent signal at the
  time a run finishes goes into that run's one email.
- No protection against overlapping runs — clicking "Run now" while the
  daily cron (or another manual run) is already in progress starts a second
  `runs` row that processes independently. Not addressed here; low-stakes
  for a single-user tool, but worth knowing.
- A company whose OpenAI call runs past `PER_COMPANY_TIMEOUT_MS` (25s, in
  `lib/research.ts`) is recorded as a per-company failure (its error goes on
  the run) and processing moves on — same as any other per-company error,
  not a retry and not a failed run. **Worst-case timing note:** with
  `CONCURRENCY` now at 2 (reduced from 5 after a pilot run hit Luna's
  200,000 TPM rate limit at concurrency 5), a full 50-company run is 25
  rounds, not 10. At the 25s
  per-company ceiling that's up to 25 × 25s = 625s in the worst case (every
  single company timing out), which exceeds Vercel's 300s Hobby limit. In
  practice most calls finish well under 25s, so this hasn't caused a
  problem yet, but the safety margin this ceiling used to provide at
  concurrency 5 no longer holds at concurrency 2 — worth keeping an eye on
  if timeouts start showing up on real runs.
- Each company is capped at 2 findings and 1200 output tokens per OpenAI
  call, to keep cost and latency down. The finding cap is a hard cap on
  breadth, not just a formatting preference — a company with more than 2
  genuinely distinct signals in a given run will only surface its top 2.
- The exact cost of a full run hasn't been measured yet on the current
  model/config — use `RESEARCH_COMPANY_LIMIT` (and `RESEARCH_COMPANY_OFFSET`
  to pilot a different slice of the watchlist) to pilot on a handful of
  companies first. See "Cost" under the OpenAI setup section above.

## Local development

```bash
npm install
cp .env.example .env.local   # fill in the values
npm run dev
```

Note: `npm install` and `npm run build` were not run in the environment
this project was generated in (no outbound network access to the npm
registry there), so do a local `npm install && npm run build` as a sanity
check before or right after your first deploy.
