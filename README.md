# Tech Spend Signal Monitor (MVP)

Watches a fixed list of 50 media & entertainment companies for public
signals that suggest future technology spending (capex/budget statements,
AI/cloud initiatives, vendor deals, tech hiring pushes, RFPs, tech
acquisitions, etc). Runs once a day, stores findings in Supabase, and emails
a digest of anything new via Resend.

This is intentionally crude: one dashboard page, one cron job, no auth, no
user accounts, no editing of the company list from the UI.

## How it works

1. Vercel Cron hits `/api/cron/research` once a day.
2. For each of the 50 companies, the app asks OpenAI (Responses API, with
   the `web_search_preview` tool) to search the web and return any new,
   sourced signals of future tech spending as JSON.
3. New signals are stored in Supabase (`signals` table); duplicates (same
   company + source URL) are skipped automatically.
4. Any signal that hasn't been emailed yet gets sent in one digest email via
   Resend, then marked as emailed.
5. The dashboard (`/`) shows the most recent 100 signals and lets you
   trigger a run manually with a "Run now" button — handy for testing
   without waiting for the daily schedule.

## Setup

### 1. Supabase

1. Create a new Supabase project.
2. Open the SQL editor and run `supabase/schema.sql`. This creates the
   `companies`, `signals`, and `runs` tables and seeds the 50-company
   watchlist.
3. From Project Settings → API, grab the **Project URL** and the
   **service_role key** (not the anon key — this app runs entirely
   server-side with no row-level security).

### 2. OpenAI

1. Grab an API key with access to the Responses API and the
   `web_search_preview` tool.
2. `OPENAI_MODEL` defaults to `gpt-5.6` in `.env.example`. Check your
   OpenAI account for which models currently support web search and set
   this env var if you need a different one.
3. This uses the OpenAI Responses API (`client.responses.create` with a
   `web_search_preview` tool) via the `openai` npm package (pinned to
   `^4.90.0`). The tool type name has changed before (this project
   originally used `web_search`, which the installed SDK version rejected
   at build time) and may change again — if `npm run build` fails on the
   `tools` array, check the current API reference at
   https://developers.openai.com/api/docs/guides/tools-web-search and the
   installed SDK's TypeScript types for the accepted value.

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
   wired up correctly (it'll take a minute or two — 50 companies, one
   OpenAI web search call each).

## Notes / known limitations (by design, for an MVP)

- No authentication on the dashboard or the `/api/run-now` endpoint. Anyone
  with the URL can view signals or trigger a run (which costs OpenAI
  usage). Fine for a private tool; add auth before sharing the URL widely.
- The 50-company list is fixed via the seed SQL. To change it, edit
  `supabase/schema.sql` and update the `companies` table directly.
- No retry/backoff logic — if OpenAI or Resend has a transient failure for
  one company, that company's error is recorded on the `runs` row and the
  loop just continues to the next company.
- Digest emails aren't batched by frequency — every unsent signal at the
  time a run finishes goes into that run's one email.

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
