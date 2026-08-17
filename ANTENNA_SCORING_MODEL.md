# Antenna Intelligence — Scoring Model v0.1 & Build Chunk 1 Reference

This document is the canonical reference for Antenna's classification/scoring system and the security, schema, and foundation changes introduced in Build Chunk 1. It exists so the product can be reconstructed later, methodology changes can be audited, and historical scores remain understandable even after the methodology evolves. Read alongside `HANDOVER.md` (general current-state overview) and `README.md` (setup/running history).

No secret values (API keys, tokens, passwords) appear anywhere in this document — only the names of environment variables and what they're for.

## 1. Security changes (Part A)

**`POST /api/run-now`** — operator-only. Requires `Authorization: Bearer <ADMIN_RUN_SECRET>`. If `ADMIN_RUN_SECRET` is unset, the endpoint fails closed (401) in every environment — there's no mode where it runs unauthenticated. `ADMIN_RUN_SECRET` is read only inside the route handler, server-side; it's never sent to the browser, never rendered into HTML, and no client component references it. The endpoint itself was kept (not removed) — it's still the operator's manual re-run tool — but it's no longer reachable from the public dashboard.

**`GET /api/cron/research`** — fail-closed policy tightened. Previously, if `CRON_SECRET` was unset, the auth check was skipped entirely (`process.env.CRON_SECRET && ...` is falsy when unset, so the whole condition short-circuits to "allow") — meaning an unset secret silently meant *public, unauthenticated access*, not "no protection configured yet." Now: if `CRON_SECRET` is unset **and the app is running on Vercel at all** (detected via the platform-provided `VERCEL` env var, not just `NODE_ENV === "production"`), every request is rejected with 401. An unset secret is only tolerated in pure local development (`next dev`, no Vercel environment present), to keep local testing convenient.

This is a deliberately stricter reading than "fail closed in production" taken literally — Vercel preview deployments have their own publicly reachable URLs and are just as capable of triggering paid research as production if left unauthenticated, so the fail-closed check applies to any Vercel-hosted environment, not only the production one. Flagging this as an interpretation, not a silent scope change: the instruction said "production," this implementation reads "any deployed environment" as the safer match for the stated goal ("no public visitor should be able to trigger paid research").

**Public dashboard (`app/page.tsx`)** — the "Run now" button (`RunNowButton`) is no longer imported or rendered. The component file itself (`app/components/RunNowButton.tsx`) still exists in the repo, unused, in case it's reused behind an operator-only surface later — it was not deleted, since deleting it wasn't required and keeping it costs nothing (it can't be triggered from anywhere without the removed import). No replacement public trigger was added, per the instructions.

## 2. Schema changes (Parts B, D, E)

All changes live in `supabase/002_antenna_intelligence_v0.1.sql`, applied on top of the original `supabase/schema.sql`. Every change is additive: new nullable columns, new tables, new indexes — nothing dropped, renamed, or backfilled. Historical `signals` rows are unaffected and will simply have `NULL` in every new column, which the application already treats as "not yet classified" (see §5).

### `signals` — new columns

| Column | Type | Notes |
|---|---|---|
| `theme` | text | One of the 10 canonical themes (§3), or `NULL`. CHECK-constrained. |
| `signal_type` | text | One of the 5 canonical Intent dimensions (§4), or `NULL`. CHECK-constrained. |
| `confidence_score` | int | 0–100, or `NULL`. CHECK-constrained. |
| `intent_score` | int | 0–100, or `NULL`. CHECK-constrained. |
| `scoring_version` | text | e.g. `v0.1`. Set by application code, not the model (see §6). |
| `classification_reason` | text | Free text explaining the two scores above. |
| `confirmed_spend_amount` | numeric | Only populated when the source states an explicit figure. See §6. |
| `confirmed_spend_currency` | text | ISO 4217 code, only alongside a confirmed amount. |
| `estimated_opportunity_low` | numeric | **Always NULL in v0.1** — no code populates this yet. |
| `estimated_opportunity_high` | numeric | **Always NULL in v0.1** — no code populates this yet. |
| `estimated_opportunity_currency` | text | **Always NULL in v0.1** — no code populates this yet. |
| `opportunity_strength` | text | **Always NULL in v0.1** — no code populates this yet. CHECK-constrained to `strong`/`emerging`/`limited` for when it eventually is. |

CHECK constraints always allow `NULL` (e.g. `theme is null or theme in (...)`), so unscored/historical rows are never rejected — the constraint only fires if a *non-null* value is outside the canonical set. Constraints were added with a drop-then-add pattern (`drop constraint if exists ...; add constraint ...`) since Postgres has no `ADD CONSTRAINT IF NOT EXISTS` — the migration file is safe to re-run.

### `subscribers` (new table)

Foundations only — see §8. `id`, `email` (required, unique), `created_at`, `last_seen_at`, `source`, `referrer`, `is_suppressed` (boolean, default false), `selected_themes` (text array), `organisation`, `job_title`, `customer_status`, `metadata` (jsonb, default `{}`). No code writes to this table yet.

### `daily_reports` (new table)

Foundations only — see §9. `id`, `report_date` (date, unique), `headline`, `summary`, `generated_at`, `scoring_version`, `report_data` (jsonb, default `{}`), `status` (default `'draft'`). No code writes to this table yet.

## 3. Canonical taxonomy (10 themes)

Defined once, in code, at `lib/antennaTaxonomy.ts` (`ANTENNA_THEMES`) — this is the single source of truth that both the research prompt and the database CHECK constraint are generated from/must match:

1. AI & Automation
2. Cloud & IP Transformation
3. Streaming & Distribution
4. Live & Sports Production
5. Content Supply Chain & Workflow
6. Trust, Security & Provenance
7. Creator & Audience Technology
8. Advertising & Monetisation
9. Sustainability & Efficiency
10. Connectivity & Infrastructure

Canonical for this phase. Do not add, remove, or rename without product approval — if the taxonomy changes, both `lib/antennaTaxonomy.ts` and the `signals_theme_check` constraint in a new migration file must be updated together, and the change should be considered alongside whether it warrants a new scoring version (§10).

## 4. Canonical Intent dimensions (5 signal types)

Defined in `lib/antennaTaxonomy.ts` (`ANTENNA_SIGNAL_TYPES`):

1. `expenditure`
2. `procurement`
3. `strategy`
4. `projects_launches`
5. `hiring`

Every signal has exactly **one** primary `signal_type` — the dimension the strongest underlying evidence supports, chosen by the model at classification time. If evidence legitimately touches more than one dimension, the model is instructed to name the secondary dimension in `classification_reason` rather than store multiple primary types — this prevents one signal from artificially inflating apparent breadth across dimensions.

## 5. How classification happens (model, prompt, validation)

**Model:** the same call already used for research — `gpt-5.6-luna` (via `client.responses.create`, Responses API, `web_search_preview` tool), by default. No second OpenAI call was introduced for scoring; classification instructions were folded into the existing prompt so it happens as part of the single research call per company (see Part C requirement not to double the cost of a web-search call). If this later proves to measurably hurt either research quality or classification quality, that's worth revisiting as a real trade-off — not assumed away here.

**Prompt:** the full, current prompt template lives in `lib/research.ts` (`PROMPT_TEMPLATE`). Reproduced here verbatim for the record — if the prompt changes, update this copy too so this document stays a faithful audit trail rather than drifting from the code:

```
You are monitoring the media & entertainment company "{company.name}" ({company.website}) for PUBLIC signals that suggest FUTURE TECHNOLOGY SPENDING. That means things like:
- capital expenditure or budget statements about cloud, streaming, or data infrastructure
- AI, machine learning, or automation initiatives
- earnings call remarks or executive interviews describing technology investment plans
- press releases about new technology vendor deals or partnerships (e.g. AWS, Azure, GCP, Nvidia, Adobe, Salesforce)
- major technology-related hiring pushes or job postings
- technology RFPs, procurement announcements, or tenders
- acquisitions of technology companies or startups
- new internal AI/technology teams, labs, studios, or platform launches — including associated specialist hiring (e.g. a new "AI Creative Lab," an AI-native production platform, a technology division consolidation)

Search the web for the most recent such signals, ideally from the last 90 days. Check company press releases/newsroom and investor relations pages as well as relevant trade press (e.g. Variety, Deadline, Broadcast, Digital TV Europe, The Hollywood Reporter). Only include genuine, specific, sourced findings with a real URL. Do not include generic company background, financial results with no technology angle, or speculation.

Return AT MOST the 2 strongest findings — the most specific, most recent, best-sourced ones. Do not pad the list; if there is only 1 (or 0), return only that many. Keep "detail" tight: 1-2 sentences, not 2-4.

Once you've identified each finding, classify it using the Antenna Intelligence Scoring Model v0.1 below. Consistency and explainability matter more than false precision — if you're between two values, prefer the lower/more conservative one and say why in classification_reason.

THEME — assign exactly one, verbatim, from this list:
AI & Automation; Cloud & IP Transformation; Streaming & Distribution; Live & Sports Production; Content Supply Chain & Workflow; Trust, Security & Provenance; Creator & Audience Technology; Advertising & Monetisation; Sustainability & Efficiency; Connectivity & Infrastructure

SIGNAL_TYPE — assign exactly one primary dimension representing the STRONGEST underlying evidence for this finding (not several, even if more than one applies — you may mention a secondary dimension in classification_reason instead):
expenditure | procurement | strategy | projects_launches | hiring

CONFIDENCE_SCORE (integer 0-100) — "How certain are we this evidence is genuine, specific, and correctly interpreted?" Do not raise this merely because a finding sounds commercially interesting.
- 90-100 (very high): primary company/IR/regulatory source, official procurement/tender, explicit programme or expenditure, signed contract, acquisition, named project, direct executive statement — little or no interpretation required.
- 75-89 (high): reputable trade/business press reporting specific activity, named technology initiative, named vendor, defined hiring programme, specific strategic investment — strong evidence but may not come directly from the company.
- 60-74 (moderate): credible evidence but some inference required — timing, scale, or technology scope partly unclear, or the buying implication isn't fully explicit.
- 40-59 (low): indirect or ambiguous evidence, weak sourcing, substantial interpretation required.
- Below 40: normally do not return this as a signal at all.

INTENT_SCORE (integer 0-100) — "How strongly does this evidence indicate current or forthcoming technology investment?" Driven by buying/investment STAGE, not by how exciting the story sounds.
- 95-100: money is demonstrably moving — confirmed material technology expenditure, signed vendor agreement, completed/announced technology acquisition, awarded procurement, explicit approved technology budget with delivery underway.
- 88-94: active buying/procurement — live RFP/tender, active vendor selection, formal procurement process, explicit budget allocated with suppliers being evaluated, late-stage evaluation with near-term implementation.
- 80-87: concrete programme with clear investment implication — named technology transformation programme, platform/product/technology launch requiring implementation, major new capability with a delivery timeline, explicit plan to build/deploy specific infrastructure or systems.
- 70-79: strong strategic investment signal — explicit executive commitment to invest materially in a defined technology area, creation of a dedicated AI/cloud/technology team or lab, substantial specialist hiring attached to a named initiative, clearly stated near-term implementation plans without procurement evidence yet.
- 60-69: credible emerging intent — technology identified as a strategic priority, repeated executive statements about future investment, meaningful specialist hiring without a clearly identified programme, exploratory pilots with credible potential to scale.
- 45-59: early directional signal — isolated specialist hiring, early experimentation, broad strategy statements, partnership exploration with unclear buying implications.
- Below 45: normally do not return this as a signal unless there is a compelling reason — if you do, state that reason explicitly in classification_reason.

Within the correct band, choose the exact number using these factors IN THIS ORDER: (1) buying stage — how close to actual expenditure; (2) specificity — is there a named project, vendor, budget, technology, or timeline; (3) evidence strength — how directly the evidence establishes the claimed intent; (4) recency — newer evidence beats otherwise-equivalent older evidence; (5) scale/materiality — only where genuinely evidenced, may justify the upper end of the band. Do not apply hidden bonuses, arbitrary points, or unstated weighting — every score must be defensible from classification_reason alone.

CLASSIFICATION_REASON — 1-3 concise sentences a reader could use to verify both scores without re-reading the source: name the evidence you weighted and which band/factor drove the number.

CONFIRMED_SPEND_AMOUNT / CONFIRMED_SPEND_CURRENCY — ONLY populate these if the source states an explicit monetary figure (e.g. "a $50 million cloud migration"). Leave both null if the figure is inferred, estimated by you, or simply absent from the source. Never estimate a number yourself.

Do not include an Opportunity score or Opportunity strength field — Antenna does not calculate those yet.

Respond with ONLY a JSON array (no markdown fences, no commentary before or after). Each item must have this shape:
{"summary": "...", "detail": "...", "source_url": "...", "source_title": "...", "published_date": "YYYY-MM-DD or null", "theme": "...", "signal_type": "...", "confidence_score": 0-100, "intent_score": 0-100, "classification_reason": "...", "confirmed_spend_amount": number or null, "confirmed_spend_currency": "... or null"}

If you find nothing relevant, respond with exactly: []
```

**`max_output_tokens`** was raised from 1200 to 2000 alongside this change. `max_output_tokens` caps the entire Responses API turn — the model's web-search tool use as well as the final JSON text, not just the JSON — and the per-finding payload roughly doubled in field count with this change (see the "Recall tuning" note in `README.md` for the earlier truncation incident this exact failure mode caused). This is a mechanical adjustment to avoid re-introducing that truncation risk, not a cost or product decision — flagged here for visibility since it does have a (modest) cost implication.

**Server-side validation (`lib/research.ts`):** the model's raw JSON is never trusted as-is.
- `theme` and `signal_type` are matched exactly (after trimming/case-normalizing `signal_type`) against the canonical lists in `lib/antennaTaxonomy.ts`; anything that doesn't match becomes `null`.
- `confidence_score` and `intent_score` are coerced to a number, clamped to `[0, 100]`, and rounded; anything non-numeric becomes `null` (not `0` — a missing score is not the same as a score of zero).
- `classification_reason` is trimmed; empty becomes `null`.
- `confirmed_spend_amount` must be a positive finite number or it becomes `null`; `confirmed_spend_currency` must match a 3-letter code pattern or it becomes `null`.
- **Critically: a finding with invalid/unparseable classification fields is still stored** — only `summary` and `source_url` being present is required to keep a finding, exactly as before this change. This was a deliberate choice to protect research recall: rejecting an otherwise-good signal just because the model mis-formatted a classification field would silently reduce the number of stored signals, which conflicts with the priority (stated throughout this build) of not degrading research quality. The trade-off is that some stored signals will have real evidence but `null` classification — visible and expected, not a bug.
- `scoring_version` is **not** taken from the model at all — it's set by application code (`lib/runResearch.ts`, from the `SCORING_VERSION` constant) to guarantee it's always exactly right rather than trusting the model to reproduce a literal string correctly.

## 6. Assumptions made during implementation

These are implementation-level judgment calls made to ship Part C as specified, not product/methodology decisions — flagged here per the instruction to report anything not explicitly defined, but these are narrow enough that I proceeded rather than blocking on them:

- **No hard code-level floor drops findings below the "normally do not store" confidence/intent thresholds** (confidence < 40, intent < 45). The prompt instructs the model not to return such findings, but nothing in the application code enforces this as a hard filter. This was intentional — the source material itself says "unless there is a compelling reason" for the intent threshold, implying judgment rather than a hard cutoff, and a code-level floor risks silently dropping genuine low-but-real signals. **This is worth an explicit decision**: should sub-threshold findings be hard-blocked in code, soft-flagged for review, or left entirely to the model's judgment as implemented now?
- **`confirmed_spend_amount`/`confirmed_spend_currency` are populated by the model**, not left permanently null, when — and only when — the source states an explicit figure. This reads as directly supported by Part B's own description ("Confirmed spend should only be populated where an actual monetary figure is supported by the source/evidence") rather than an independent decision to invent a methodology, but flagging it since it's the one place in the model's output that produces a number resembling a "value."
- **Findings with unparseable classification are stored anyway, with null classification fields**, as described in §5 — prioritizing not regressing recall over guaranteeing every stored row is fully classified.

## 7. Known weaknesses / unresolved methodology decisions

- **Confidence/Intent scores are not independently verifiable.** They're the model's own self-assessment against the written bands, not computed from any independent signal. Consistency depends entirely on the model following the prompt faithfully — there's no server-side re-scoring or spot-check mechanism yet.
- **No company-level or theme-level aggregation exists yet.** Every score in this chunk is per-signal only. See §11/§12 (methodology proposals) — these need approval before any roll-up is implemented.
- **No numeric or qualitative Opportunity scoring exists yet**, per explicit scope — the schema fields exist and are always null.
- **The sub-threshold cutoff question in §6** is unresolved and needs a decision.
- **No automated evaluation harness** exists to check whether the model's classification is actually consistent across companies/runs — this was out of scope for Chunk 1 but is worth planning for before this scoring feeds anything customer-facing.
- **`gpt-5.6-luna` is a cost-optimized tier**, chosen earlier in this project for research cost/speed, not for classification accuracy specifically — its classification judgment hasn't been separately validated against a stronger model as a baseline.

## 8. Subscriber architecture (Part D)

`subscribers` table only — no capture form, no auth, no email sending against it, per explicit scope. Only `email` is required (unique, not null); every other field is nullable so the row can be created with just an email address and enriched later (selected themes, organisation, job title, customer status, a free-form `metadata` jsonb for whatever else comes up) without restructuring the table. `is_suppressed` exists now so a future unsubscribe/bounce-handling flow has somewhere to write to without a schema change at that point.

## 9. Report architecture decision (Part E)

**Decision: implemented `daily_reports` as a snapshot table**, schema only (no generation job).

Reasoning, at the ≥95%-confidence bar requested: a stored daily snapshot is the standard, well-established pattern for exactly this requirement — "generate once, serve many, preserve history, don't let a later logic change silently rewrite what was shown on a past date." The alternative (reconstructing a report dynamically from `signals` on every page load) fails the explicit requirement to retain historical reports independent of future logic changes: a dynamic reconstruction run today against yesterday's signals would use *today's* aggregation logic, producing a different result than what a visitor actually saw yesterday — which is precisely the failure mode called out in the brief ("yesterday's market interpretation silently changing when underlying logic changes"). A snapshot avoids this by construction: whatever was computed and stored on a given `report_date` stays exactly that, forever, regardless of later methodology changes. This isn't a close call between comparably-good options — it's a well-known, low-risk pattern with a specific, correctly-identified failure mode on the other side, which is why it clears the confidence bar to implement now rather than report back as an open question.

**What was and wasn't built:** only the table (`id`, `report_date` unique, `headline`, `summary`, `generated_at`, `scoring_version`, `report_data` jsonb, `status` defaulting to `'draft'`). No cron job, no generation logic, and nothing writes to this table yet. That's deliberate — generating a real daily report requires the company-level and theme-level aggregation methodologies, and those are explicitly deferred pending approval (§11, §12). Building the generation pipeline now would mean either inventing that methodology unapproved (against explicit instructions) or writing a report generator around a placeholder methodology that would need rework anyway. The `status` field defaulting to `'draft'` and the presence of `scoring_version` on each report row are there so that, once generation exists, a report can be validated before going live and can always be traced back to exactly which scoring methodology produced it.

## 10. Scoring versioning

`scoring_version` is stored on every classified signal (currently always `"v0.1"`, set in code — see §5). The intent: if the methodology changes materially (band definitions, taxonomy, aggregation formulas once approved), that becomes a new version string (e.g. `v0.2`), not a silent redefinition of what `v0.1` meant. Historical signals keep their original `scoring_version` and their original scores — **no retroactive rescoring/overwriting without an explicit, separate migration decision**. This means a future UI can always show "scored under v0.1" next to an old signal rather than presenting it as if it had been scored under whatever the current methodology is.

## 11. Methodology proposal — Company Intent Score aggregation (NOT implemented, needs approval)

This section is a proposal only, per explicit instruction not to implement or silently choose company-level aggregation. Provided so it can be reviewed and either approved, amended, or rejected before any code is written.

**Proposed approach — "strongest-signal-anchored, breadth-adjusted":**

1. **Per-dimension component score** (Expenditure / Procurement / Strategy / Projects & Launches / Hiring): for a company with one or more signals in a dimension, the component score is the `intent_score` of the single strongest (highest-`intent_score`) signal in that dimension from the last 12 months, with a smaller upward nudge for genuine reinforcement — e.g. `component = strongest_intent_score + min(10, 3 × (count_of_other_signals_in_same_dimension_within_90_days))`, capped at 100. Rationale: one very strong signal shouldn't be diluted by averaging it with weaker ones in the same dimension, but multiple reinforcing signals in the same dimension over a short window are genuinely more convincing than one, so a small bounded bonus (not an average) reflects that without letting a pile of weak signals out-vote one strong one.
2. **Missing dimensions:** a dimension with no qualifying signal is excluded from the calculation entirely — not treated as 0 — consistent with §C5's "absence of evidence is not evidence of no intent."
3. **Signal age / recency:** each signal's contribution decays with age — e.g. full weight for signals ≤90 days old, linearly decaying to a floor weight (not zero) by 12 months, and excluded entirely beyond 12 months. Exact decay curve is a parameter to agree on, not assumed here.
4. **Overall Company Intent Score = the single highest component score, plus a bounded breadth bonus for additional dimensions with real evidence** — e.g. `overall = max(component scores) + min(15, 5 × (number_of_other_dimensions_with_a_component_score))`, capped at 100. Rationale: breadth across dimensions is real corroborating evidence (a company that's hiring, has a named programme, *and* is in procurement is a stronger buyer than one with just a single strong procurement signal) — but it should never let several moderate signals outrank one clearly stronger, more advanced-stage signal on its own, which is why breadth is a small bounded addition on top of the strongest component, not an average or a sum.
5. **Worked example — Company A** (Procurement: 95, all other dimensions no evidence): overall = 95 + 0 (no other dimensions with evidence) = **95**.
6. **Worked example — Company B** (Strategy: 75, Hiring: 72, Projects & Launches: 70, Expenditure: 68, Procurement: no evidence): strongest component = 75 (Strategy); breadth bonus = min(15, 5×3) = 15 (three other dimensions with evidence); overall = 75 + 15 = **90**.
7. Under this proposal, Company A (**95**) still outranks Company B (**90**) — a single very-advanced-stage procurement signal remains the strongest possible indicator, but broad, reinforcing strategic/hiring/launch activity across four dimensions closes most of the gap rather than being dismissed. This directly addresses the stated risk (many-weak-signals shouldn't beat one-strong-signal) while still rewarding genuine breadth — Company B doesn't overtake Company A, but isn't buried by the comparison either.

This is one reasonable design, not the only one — alternatives (pure max with no breadth bonus; a weighted average across dimensions; a max-of-recent-signals-only approach) were considered and rejected mainly because they either erase the value of breadth entirely or let weak breadth dominate a genuinely stronger single signal. Needs your review before implementation, including the exact decay curve and bonus caps, which are placeholder numbers here pending agreement.

## 12. Methodology proposal — Market/Theme Intent Score (NOT implemented, needs approval)

Also a proposal only, not implemented.

**Proposed approach:**

1. For each theme, consider all signals tagged with that `theme` across all companies within a trailing window (e.g. 90 days, matching the research recency window already used).
2. **Active company count:** number of distinct companies with at least one qualifying signal in the theme.
3. **Strength:** the average of each contributing company's *Company Intent Score* (§11) for that theme's relevant dimension(s) — not a raw average of every individual signal, so one company with many signals doesn't dominate purely on volume.
4. **Breadth of signal types:** a bonus for the theme having evidence spread across multiple signal_type dimensions (procurement, hiring, strategy, etc.) rather than concentrated in one — analogous to the per-company breadth bonus in §11, same rationale.
5. **Confirmed spend:** where `confirmed_spend_amount` exists on contributing signals, a modest additive factor scaled to spend magnitude relative to other themes in the same period — deliberately capped/dampened so a single large confirmed figure doesn't overwhelm everything else, given how rarely `confirmed_spend_amount` will be populated (§6).
6. **Recency:** same decay approach as §11, applied at the signal level before rolling up.
7. **Momentum vs. previous period:** the theme score for the current trailing window compared to the immediately preceding window of the same length, expressed as a direction/delta (e.g. "+8 vs. last period") rather than folded into the score itself — so momentum is visible without being double-counted into the absolute number.
8. **Explicitly addressing the stated risk** (many weak signals outranking fewer strong ones): because strength (step 3) is anchored on *company*-level Intent Scores — which are themselves strongest-signal-anchored, not averaged (§11) — a theme with 20 companies each showing one weak, isolated signal will not automatically outrank a theme with 3 companies each showing very strong, advanced-stage signals, since each contributing company's score already resists dilution before it ever reaches the theme roll-up. Active company count (step 2) is a secondary factor, not the primary driver.

As with §11, this is a proposed design with placeholder weights/caps, not a final formula — needs review and agreement (particularly the exact balance between company count and company strength, and the spend-magnitude dampening curve) before implementation.

## 13. Environment variables (names only — no values)

New in this chunk:

- `ADMIN_RUN_SECRET` — required, protects `POST /api/run-now`.

Existing, unchanged:

- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY`
- `OPENAI_MODEL` (optional)
- `RESEARCH_COMPANY_LIMIT` (optional)
- `RESEARCH_COMPANY_OFFSET` (optional)
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`
- `DIGEST_EMAIL_TO`
- `CRON_SECRET` — now effectively required on any Vercel deployment, not just recommended (see §1).

No API keys, passwords, bearer-token values, or other secrets appear in this document or were handled outside environment variables at any point.
