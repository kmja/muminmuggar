import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getMug } from "@/lib/mugs";
import { mugQuery, searchMarketplaces } from "@/lib/marketplaces";
import { groundedDealSearch } from "@/lib/gemini";
import { currentOwner, unauthorized } from "@/lib/session";
import type { Listing } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function persistListings(mugId: string, listings: Listing[]) {
  for (const l of listings) {
    await query(
      `INSERT INTO listings (mug_id, source, title, price, currency, url, image_url, condition)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (mug_id, url) DO NOTHING`,
      [mugId, l.source, l.title, l.price, l.currency, l.url, l.imageUrl, l.condition],
    );
  }
}

export async function POST(req: Request) {
  const owner = await currentOwner();
  if (!owner) return unauthorized();
  try {
    const { mugId } = await req.json();
    const mug = await getMug(String(mugId), owner);
    if (!mug) return NextResponse.json({ error: "Mug not found" }, { status: 404 });

    const q = mugQuery(mug);

    // Structured sources (persisted so cron dedupes against them too).
    const structured = await searchMarketplaces(mug);
    if (structured.length) await persistListings(mug.id, structured);

    // Broad web search (prose + linked sources) — best-effort.
    let web: { text: string; sources: { title: string; uri: string }[] } = { text: "", sources: [] };
    try {
      web = await groundedDealSearch(q);
    } catch (e) {
      web = { text: `Web search unavailable: ${(e as Error).message}`, sources: [] };
    }

    return NextResponse.json({ query: q, listings: structured, web });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
