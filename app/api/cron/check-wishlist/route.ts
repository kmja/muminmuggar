import { NextResponse } from "next/server";
import { query, rowToMug } from "@/lib/db";
import { anyStructuredSource, searchMarketplaces } from "@/lib/marketplaces";
import { sendToAll, pushConfigured } from "@/lib/push";
import type { Listing } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // no secret configured -> open (fine for a private deploy)
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

async function run() {
  const summary: { checked: number; newListings: number; notified: number; sources: boolean } = {
    checked: 0,
    newListings: 0,
    notified: 0,
    sources: anyStructuredSource(),
  };
  if (!summary.sources) return summary; // nothing structured to poll reliably

  const { rows } = await query("SELECT * FROM mugs WHERE status = 'wishlist'");
  const wishlist = rows.map(rowToMug);
  summary.checked = wishlist.length;

  const found: { mugName: string; count: number }[] = [];

  for (const mug of wishlist) {
    let listings: Listing[] = [];
    try {
      listings = await searchMarketplaces(mug);
    } catch (e) {
      console.error("search error for", mug.name, e);
      continue;
    }
    let fresh = 0;
    for (const l of listings) {
      const res = await query(
        `INSERT INTO listings (mug_id, source, title, price, currency, url, image_url, condition, notified)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8, TRUE)
         ON CONFLICT (mug_id, url) DO NOTHING
         RETURNING id`,
        [mug.id, l.source, l.title, l.price, l.currency, l.url, l.imageUrl, l.condition],
      );
      if (res.rowCount && res.rowCount > 0) fresh++;
    }
    if (fresh > 0) found.push({ mugName: mug.name, count: fresh });
    summary.newListings += fresh;
  }

  if (found.length && pushConfigured()) {
    const total = found.reduce((a, b) => a + b.count, 0);
    const names = found.map((f) => f.mugName).slice(0, 3).join(", ");
    summary.notified = await sendToAll({
      title: "New Moomin mug listings found! 🫖",
      body: `${total} new listing${total === 1 ? "" : "s"} for ${names}${found.length > 3 ? "…" : ""}. Tap to view.`,
      url: "/?tab=wishlist",
    });
  }

  return summary;
}

export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json({ ok: true, ...(await run()) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export const POST = GET;
