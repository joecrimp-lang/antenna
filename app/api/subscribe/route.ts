import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// Public demand-validation capture only, per the brief: explicitly NOT an
// auth/account system. Writes straight into the existing `subscribers`
// table (schema-only since Build Chunk 1; email has been its first real
// writer since Phase 3B). No confirmation email, no Resend, no Stripe, no
// alerts wiring, none of that is built here.
//
// Phase 3B.2 (decision doc §6): company and job title are optional and map
// straight onto the `organisation`/`job_title` columns that have existed on
// `subscribers` since Build Chunk 1 (supabase/002_antenna_intelligence_v0.1
// .sql) — no migration needed, this is purely accepting two more optional
// fields on an existing write path.

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_FIELD_LENGTH = 200;

export async function POST(request: NextRequest) {
  let body: { email?: unknown; source?: unknown; company?: unknown; jobTitle?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const source = typeof body.source === "string" ? body.source.slice(0, 100) : null;
  const company =
    typeof body.company === "string" && body.company.trim()
      ? body.company.trim().slice(0, MAX_FIELD_LENGTH)
      : null;
  const jobTitle =
    typeof body.jobTitle === "string" && body.jobTitle.trim()
      ? body.jobTitle.trim().slice(0, MAX_FIELD_LENGTH)
      : null;

  if (!email || !EMAIL_PATTERN.test(email)) {
    return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
  }

  try {
    const supabase = getSupabase();
    // Upsert on the existing unique `email` constraint: a repeat signup just
    // refreshes last_seen_at/source/organisation/job_title rather than
    // erroring, since "already on the list" should feel like success to the
    // visitor, not a failure.
    const { error } = await supabase.from("subscribers").upsert(
      {
        email,
        source,
        organisation: company,
        job_title: jobTitle,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: "email" }
    );

    if (error) {
      console.error("Supabase error inserting subscriber:", error);
      return NextResponse.json({ error: "Could not save your email right now" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Subscribe route error:", err);
    return NextResponse.json(
      { error: (err as Error).message || "Unexpected error" },
      { status: 500 }
    );
  }
}
