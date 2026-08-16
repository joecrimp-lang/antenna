import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { startRun, processBatchAndContinue } from "@/lib/runResearch";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Triggered daily by Vercel Cron (see vercel.json). Vercel automatically
// sends CRON_SECRET as a bearer token when it's set as an env var. Creates
// the run row and responds immediately; the batches are processed and
// chained in the background afterward (see lib/runResearch.ts and
// /api/continue-research).
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  try {
    const runId = await startRun();
    waitUntil(processBatchAndContinue(runId, 0).catch(() => {}));
    return NextResponse.json({ started: true, runId });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
