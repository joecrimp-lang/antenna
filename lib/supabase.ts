import { createClient } from "@supabase/supabase-js";
import type {
  AntennaOpportunityStrength,
  AntennaSignalType,
  AntennaTheme,
} from "./antennaTaxonomy";

// Server-only client using the service role key. This app has no user-facing
// auth, so every route that touches the database uses this single client.
export function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars"
    );
  }

  return createClient(url, key, {
    auth: { persistSession: false },
  });
}

export type Company = {
  id: number;
  rank: number;
  name: string;
  website: string | null;
  country: string | null;
};

export type Signal = {
  id: number;
  company_id: number;
  summary: string;
  detail: string | null;
  source_url: string | null;
  source_title: string | null;
  published_date: string | null;
  created_at: string;
  emailed_at: string | null;
  // Antenna Intelligence v0.1 — additive, all nullable. Historical rows
  // predate classification and will have null here; the app must keep
  // rendering them correctly. See ANTENNA_SCORING_MODEL.md.
  theme: AntennaTheme | null;
  signal_type: AntennaSignalType | null;
  confidence_score: number | null;
  intent_score: number | null;
  scoring_version: string | null;
  classification_reason: string | null;
  confirmed_spend_amount: number | null;
  confirmed_spend_currency: string | null;
  // Opportunity fields exist for future use only — no code populates these
  // in v0.1 (no approved methodology yet). Always null for now.
  estimated_opportunity_low: number | null;
  estimated_opportunity_high: number | null;
  estimated_opportunity_currency: string | null;
  opportunity_strength: AntennaOpportunityStrength | null;
};

// Foundations for the future email-gated report experience (Build Chunk 1,
// Part D). No code writes to this table yet — capture form, auth, and
// suppression handling are all later work. Only `email` is required.
export type Subscriber = {
  id: number;
  email: string;
  created_at: string;
  last_seen_at: string | null;
  source: string | null;
  referrer: string | null;
  is_suppressed: boolean;
  selected_themes: string[] | null;
  organisation: string | null;
  job_title: string | null;
  customer_status: string | null;
  metadata: Record<string, unknown>;
};

// Foundations for storing a generated daily intelligence report as an
// immutable snapshot (Build Chunk 1, Part E). No code generates or writes
// reports yet — company/theme roll-up methodology needs approval first
// (see ANTENNA_SCORING_MODEL.md, "Methodology proposals requiring
// approval"). Schema only.
export type DailyReport = {
  id: number;
  report_date: string;
  headline: string | null;
  summary: string | null;
  generated_at: string;
  scoring_version: string | null;
  report_data: Record<string, unknown>;
  status: string;
};
