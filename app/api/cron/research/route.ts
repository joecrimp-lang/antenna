import { NextRequest, NextResponse } from "next/server";
import { runFullResearch } from "@/lib/runResearch";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Triggered daily by Vercel Cron (see vercel.json). Vercel automatically
// sends CRON_SECRET as a bearer token when it's set as an env var.
//
// Fail-closed policy: on any Vercel deployment (preview or production —
// detected via the platform-provided `VERCEL` env var, not just
// NODE_ENV==="production", since preview URLs are just as publicly
// reachable and must not be a backdoor around this), a missing CRON_SECRET
// means the route rejects every request rather than silently allowing
// unauthenticated execution. The only place an unset CRON_SECRET is
// tolerated is pure local development (`next dev`, no Vercel env present),
// to keep local testing convenient. This is a stricter reading than "fail
// closed in production" taken literally — see the implementation report.
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const isDeployedOnVercel = Boolean(process.env.VERCEL);

  if (!secret) {
    if (isDeployedOnVercel) {
      return new NextResponse("Unauthorized", { status: 401 });
    }
    // No secret configured, but we're not running on Vercel at all — allow
    // it through for local development only.
  } else {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${secret}`) {
      return new NextResponse("Unauthorized", { status: 401 });
    }
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
