import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { startRun, processBatchAndContinue } from "@/lib/runResearch";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Manual trigger used by the "Run now" button. Creates the run row and
// responds immediately; the actual research happens afterward in the
// background via waitUntil(), processed in small batches chained through
// /api/continue-research (see lib/runResearch.ts) so no single invocation
// approaches Vercel's function timeout. This MVP has no user auth, so
// anyone with the URL can call it — fine for a private tool, but worth
// knowing.
export async function POST() {
  try {
    const runId = await startRun();
    waitUntil(
      processBatchAndContinue(runId, 0).catch(() => {
        // processBatchAndContinue already records failures on the run row
        // itself; this just prevents an unhandled rejection from surfacing.
      })
    );
    return NextResponse.json({ started: true, runId });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
