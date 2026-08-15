import { createClient } from "@supabase/supabase-js";

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
};
