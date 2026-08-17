import { NextRequest, NextResponse } from "next/server";
import { runFullResearch } from "@/lib/runResearch";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Operator-only endpoint — never exposed to public users. Antenna's public
// product must never let a visitor trigger paid OpenAI research; this is
// the only trigger for a research run outside the daily cron, and it's kept
// around purely as an admin/operator tool (e.g. to re-run after a fix).
//
// Requires "Authorization: Bearer <ADMIN_RUN_SECRET>". If ADMIN_RUN_SECRET
// isn't set at all, this endpoint fails closed (401) rather than falling
// back to "unauthenticated is fine" — there is no environment or mode where
// this runs without the secret configured. ADMIN_RUN_SECRET is only ever
// read here, server-side; it's never sent to the browser, rendered into
// HTML, or referenced from any client component.
export async function POST(request: NextRequest) {
  const secret = process.env.ADMIN_RUN_SECRET;
  const authHeader = request.headers.get("authorization");

  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const summary = await runFullResearch();
    return NextResponse.json(summary);
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
