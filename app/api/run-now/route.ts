import { NextResponse } from "next/server";
import { runFullResearch } from "@/lib/runResearch";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Manual trigger used by the "Run now" button on the dashboard, mainly for
// testing outside the daily schedule. This MVP has no user auth, so anyone
// with the URL can call it — fine for a private tool, but worth knowing.
export async function POST() {
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
