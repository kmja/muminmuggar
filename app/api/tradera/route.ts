import { NextResponse } from "next/server";
import { currentOwner, unauthorized } from "@/lib/session";
import { traderaConfigured, searchTradera } from "@/lib/tradera";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Diagnostics: run a live Tradera search and return the normalized listings.
 * Handy for confirming TRADERA_APP_ID / TRADERA_APP_KEY work once set.
 *   GET /api/tradera?q=mumin%20mugg
 */
export async function GET(req: Request) {
  const owner = await currentOwner();
  if (!owner) return unauthorized();
  const q = new URL(req.url).searchParams.get("q")?.trim() || "mumin mugg";
  if (!traderaConfigured()) {
    return NextResponse.json({ configured: false, query: q, count: 0, listings: [] });
  }
  try {
    const listings = await searchTradera(q);
    return NextResponse.json({ configured: true, query: q, count: listings.length, listings: listings.slice(0, 20) });
  } catch (e) {
    return NextResponse.json({ configured: true, query: q, error: (e as Error).message }, { status: 502 });
  }
}
