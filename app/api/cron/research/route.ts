import { NextRequest, NextResponse } from "next/server";
import { runFullResearch } from "@/lib/runResearch";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // research loops over 50 companies; give it room

// Triggered daily by Vercel Cron (see vercel.json). Vercel automatically
// sends the CRON_SECRET as a bearer token when it's set as an env var.
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return new NextResponse("Unauthorized", { status: 401 });
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
