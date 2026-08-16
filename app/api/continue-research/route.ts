import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { processBatchAndContinue } from "@/lib/runResearch";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Internal-only route: each batch triggers the next one by calling this
// route on itself (see triggerNextBatch in lib/runResearch.ts). It is never
// called by the browser or by Vercel Cron directly, so it does NOT rely on
// CRON_SECRET — Vercel only attaches that bearer token to its own scheduled
// requests, not to requests our own code makes to itself. Instead it
// requires its own explicit shared secret, INTERNAL_TRIGGER_SECRET, which
// must be set for this route to accept anything.
//
// It responds immediately (before doing any batch work) and defers the
// actual processing to waitUntil() — this is what lets the invocation that
// triggered it return quickly instead of waiting for the next batch to
// finish.
export async function POST(request: NextRequest) {
  const secret = process.env.INTERNAL_TRIGGER_SECRET;
  const provided = request.headers.get("x-internal-secret");
  if (!secret || provided !== secret) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  let body: { runId?: unknown; cursor?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body.runId !== "number" || typeof body.cursor !== "number") {
    return NextResponse.json(
      { error: "runId and cursor are required numbers" },
      { status: 400 }
    );
  }

  waitUntil(
    processBatchAndContinue(body.runId, body.cursor).catch(() => {})
  );
  return NextResponse.json({ accepted: true });
}
