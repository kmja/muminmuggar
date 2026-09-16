import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getMug } from "@/lib/mugs";
import { mugQuery, searchMarketplaces } from "@/lib/marketplaces";
import { groundedDealSearch, geminiConfigured } from "@/lib/gemini";
import { traderaConfigured } from "@/lib/tradera";
import { ebayConfigured } from "@/lib/ebay";
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

    // Search with the Swedish catalogue name (Tradera is a Swedish marketplace).
    const q = mugQuery(mug, "sv");

    // Structured sources (persisted so cron dedupes against them too).
    const structured = await searchMarketplaces(mug);
    if (structured.length) await persistListings(mug.id, structured);

    // Broad web search (prose + linked sources) — best-effort and optional.
    let web: { text: string; sources: { title: string; uri: string }[] } = { text: "", sources: [] };
    let webError = "";
    if (geminiConfigured()) {
      try {
        web = await groundedDealSearch(q);
      } catch (e) {
        webError = (e as Error).message;
      }
    }

    return NextResponse.json({
      query: q,
      listings: structured,
      web,
      webError: webError || null,
      sources: { tradera: traderaConfigured(), ebay: ebayConfigured(), web: geminiConfigured() },
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
