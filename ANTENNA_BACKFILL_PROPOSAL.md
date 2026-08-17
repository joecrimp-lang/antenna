# Historical Signal Backfill — Proposal

**Status: APPROVED AND IMPLEMENTED.** `scripts/backfillIntelligence.ts` was built exactly per the decisions below, plus a low-risk shared-validation extraction (`lib/classificationValidation.ts`) approved alongside it. See `HANDOVER.md`'s "Historical backfill" section and `ANTENNA_SCORING_MODEL.md` §14.6 for the living reference. This document is kept as the historical proposal/decision record.

**Not yet run against production data** — this sandbox has no live database or OpenAI access. The script has been type-checked and run end-to-end against stubbed Supabase/OpenAI clients (both groups, plus the theme-recalculation step, all verified to execute correctly), but the real row counts and a real run are still pending — you'll run it locally per the instructions in `HANDOVER.md`.

## 1. What's actually null, and why (two different populations)

There isn't one kind of "missing data" here — there are two, with very different backfill costs, and the plan below treats them differently:

**Group A — never classified at all** (`theme is null`): signals created before Build Chunk 1 shipped classification. These have no `theme`, `signal_type`, `confidence_score`, `intent_score`, or `classification_reason` — nothing to derive `signal_intent_score` from. Backfilling these requires an OpenAI call (there's no deterministic way to classify a finding's theme/intent from scratch).

**Group B — classified, but predates the intelligence layer** (`theme is not null and signal_intent_score is null`): signals created after Build Chunk 1 but before the v0.2 intelligence layer chunk. These already have `confidence_score`/`intent_score`/`classification_reason` — everything `signal_intent_score` needs. Backfilling these is **free**: it's the exact same deterministic arithmetic (`computeSignalIntentScore` in `lib/intelligence.ts`) already running on new signals, just applied to old rows. No OpenAI call, no cost, no meaningful time.

**I can't see your live database from this sandbox, so I don't know the actual split.** Before we lock in a cost/time estimate, please run this once in the Supabase SQL editor and share the three numbers back:

```sql
select
  count(*) filter (where theme is null) as group_a_needs_classification,
  count(*) filter (where theme is not null and signal_intent_score is null) as group_b_needs_score_only,
  count(*) as total_signals
from signals;
```

Everything below assumes Group A could be anywhere from a handful to a few hundred rows — the cost is low either way (see §4), but the exact number changes the time estimate meaningfully.

## 2. Approach: a one-off local script, not a pipeline change or new endpoint

**`scripts/backfillIntelligence.ts`** — run once, locally, by you (not deployed to Vercel, not wired into the daily cron, not a new API route). Reasoning:
- It needs to process a batch of historical rows at whatever pace OpenAI/Supabase allow, which doesn't fit Vercel's 300s Hobby-plan ceiling if Group A is large — running locally removes that constraint entirely.
- It avoids adding a new operator-protected endpoint (more surface area, more auth to think about) for something you'll plausibly only ever run once or twice.
- It reuses your existing local `.env` (same `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, `OPENAI_MODEL` you already have for local dev) — no new secrets.

Run with `npx tsx scripts/backfillIntelligence.ts` (or `ts-node`) — `tsx` via `npx` needs no permanent addition to `package.json`/`devDependencies`, so the deployed app's dependency footprint doesn't change for a one-off tool. Supports `--dry-run` (counts + cost estimate only, no writes, no OpenAI calls) and normal mode (processes everything, logs progress as it goes).

**Does not touch `lib/research.ts` or `lib/runResearch.ts`.** Reuses `computeSignalIntentScore` and `computeAndStoreThemeScores` directly from `lib/intelligence.ts` (imported, not duplicated — those are already pure/reusable). The one thing it *can't* reuse without touching `research.ts` is the classification prompt/validation logic for Group A, since those functions (`normalizeTheme`, `normalizeScore`, etc.) are private to that file — see §3 for how that's handled.

## 3. Group A — classification-only backfill (the part that costs money)

**A new, separate prompt — not `lib/research.ts`'s `PROMPT_TEMPLATE`.** The live prompt asks the model to *search the web and then classify what it finds*; a Group A row already has its finding (`summary`, `detail`, `source_url`, `source_title`, `published_date`) sitting in the database — it just needs classifying. So the backfill prompt is: **the exact same classification instructions, word-for-word**, reused from the current `lib/research.ts` block (theme/signal_type/confidence_score/intent_score bands, the 5-factor ordering, the conservative-when-torn rule, the JSON shape) **minus the search instructions**, with the already-stored finding given directly instead of asked-for. No `web_search_preview` tool — this is a plain text-in, JSON-out completion, which is both cheaper and meaningfully faster than the live per-company call (no search step eating into the time budget).

**⚠️ Decision flagged:** reproducing the classification instructions verbatim, rather than importing them, means the wording lives in two places (`lib/research.ts` and the new backfill script). This is a direct trade-off against "do not change `lib/research.ts`" — I could instead export the classification block/validation helpers from `research.ts` so both files share one source of truth, but that means editing a file you explicitly said not to touch, even for a non-behavioral change (adding `export`). **Proposing to duplicate rather than touch `research.ts`**, since that's what "do not change" most literally means — flagging it because if the prompt is ever condensed again (like the timeout fix), this backfill script's copy would need updating too, and it's easy to forget it exists since it's not part of the daily pipeline.

**Known limitation, worth accepting explicitly:** the model classifies from `summary`/`detail`/`source_title`/`published_date` only — not the original full article/page it saw when the signal was first found (that context is gone; only the compressed record was ever stored). `confidence_score` in particular may come out slightly different than if this had been classified live at discovery time, since the model is judging a compressed record rather than firsthand. This is inherent to backfilling and not fixable without re-searching (which would be a materially different, more expensive operation, and arguably re-introduces "research collection" — out of scope per your instructions).

**Recency reference point:** `computeSignalIntentScore` needs a "now" to measure evidence age against. Proposing to use **each signal's own original `created_at`** (already in the database), not today's date — this keeps the exact same rule for every signal regardless of whether it was scored live or backfilled: "how fresh was the evidence when Antenna found it," a permanent, point-in-time judgment either way. Using today's date instead would score identical evidence differently depending purely on when the backfill happened to run, which breaks reproducibility and isn't how live signals are scored.

`scoring_version` is set to the same `SCORING_VERSION` constant ("v0.1") as live classification — it labels the methodology applied, not the code path, and the methodology is byte-identical.

## 4. Cost and time

**Group B: effectively free and instant.** Pure arithmetic, no network calls beyond the Supabase read/write itself.

**Group A: cheap, per current Luna pricing** ($1/$6 per 1M input/output tokens — see README "Cost"). A classification-only call has a much smaller footprint than a full research call: no search-tool overhead, a shorter prompt (no search instructions), and a 1-finding JSON response instead of up to 2. Rough estimate per signal: ~700-900 input tokens, ~150-250 output tokens → **roughly $0.001–0.002 per signal.** Even at 500 historical signals, that's **around $0.50–1.00 total** — not a meaningful cost at any plausible volume here.

**Time:** no web search means no 20+ second search latency per call — a classification-only completion on Luna should typically finish in a few seconds. Proposing modest concurrency (e.g. 3 in flight at once, similar spirit to `runResearch.ts`'s `CONCURRENCY`, just a bit higher since there's no search-tool rate-limit pressure) and a 20s per-call timeout (`maxRetries: 0`, same style as the live pipeline). At that pace, even a few hundred Group A rows should finish in well under 10 minutes. Please share the actual count from §1's query so I can give you a real number rather than a range.

## 5. Safety, idempotency, and reporting

- **Safe to re-run:** the script queries `where theme is null` (Group A) and `where theme is not null and signal_intent_score is null` (Group B) fresh each time it runs — any row already backfilled no longer matches, so re-running only ever touches what's still outstanding. If interrupted partway (Ctrl-C, network blip), just run it again.
- **Per-row error handling:** one failing/malformed classification is caught and logged, never halts the batch — same fault-tolerant pattern as `processCompany` in `runResearch.ts`. A row that fails to classify simply stays `theme is null` and gets retried on the next run (cheap enough that this is fine — no retry cap needed).
- **Progress + final report:** logs as it goes (e.g. `[142/380] classified — theme: AI & Automation, intent 74`) and prints a summary at the end: rows processed per group, rows successfully updated, rows that failed/stayed null, and total OpenAI cost estimate (token counts are available on every Responses API response).
- **Theme scores recalculated once, at the end:** after both passes finish, calls `computeAndStoreThemeScores` (imported from `lib/intelligence.ts`, unchanged) exactly once, so `theme_scores`/`theme_score_snapshots` reflect the now-larger classified corpus. **Note:** this adds one new row per theme to `theme_score_snapshots` outside the normal daily-cron cadence — an accurate reflection of a real event (the historical corpus materially changed), not a bug, but flagging it since it's a deviation from "snapshots happen once a day."

## 6. Decisions needing your input before I write this

1. **Run the count query in §1** and share the three numbers — this firms up the time estimate (cost is negligible regardless).
2. **Duplicating the classification prompt/validation logic** into the new script rather than exporting it from `research.ts` (§3) — confirm this reading of "do not change `lib/research.ts`" is what you intended, or if you'd rather I export the shared logic instead (a small, additive, non-behavioral edit to that file).
3. **Local script, not a new admin endpoint** — confirm, or would you prefer a protected `POST /api/admin/backfill` route instead (works from anywhere, but adds a new endpoint, needs its own care around the Vercel timeout for a large Group A, and needs an idle safeguard so it can't be called twice at once)?
4. **Concurrency (3) and per-call timeout (20s)** for the classification calls — fine as defaults, or would you like these tuned?
5. **Accepting the confidence/known-limitation caveat in §3** (classification is from the stored summary/detail, not the original full source) as a documented trade-off, not something to try to work around.

No code written yet — next step on approval is `scripts/backfillIntelligence.ts` plus a short addition to `HANDOVER.md`/`ANTENNA_SCORING_MODEL.md` documenting that this backfill exists, when it was run, and what it did.
