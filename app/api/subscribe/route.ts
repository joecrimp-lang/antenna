import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// Public demand-validation capture only — per the brief, explicitly NOT an
// auth/account system. Writes straight into the existing `subscribers`
// table (schema-only since Build Chunk 1; this is its first real writer).
// No confirmation email, no Resend, no Stripe, no alerts wiring — none of
// that is built here.

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: NextRequest) {
  let body: { email?: unknown; source?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const source = typeof body.source === "string" ? body.source.slice(0, 100) : null;

  if (!email || !EMAIL_PATTERN.test(email)) {
    return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
  }

  try {
    const supabase = getSupabase();
    // Upsert on the existing unique `email` constraint: a repeat signup just
    // refreshes last_seen_at/source rather than erroring, since "already on
    // the list" should feel like success to the visitor, not a failure.
    const { error } = await supabase
      .from("subscribers")
      .upsert(
        { email, source, last_seen_at: new Date().toISOString() },
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
