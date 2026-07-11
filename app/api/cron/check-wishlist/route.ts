import { NextResponse } from "next/server";
import { query, rowToMug } from "@/lib/db";
import { sourcesAvailable, searchMarketplaces } from "@/lib/marketplaces";
import { syncCatalogOnce } from "@/lib/catalog";
import { sendToOwner, pushConfigured } from "@/lib/push";
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
  // Keep the stored product-image catalog fresh (non-fatal if it fails).
  try { await syncCatalogOnce(); } catch (e) { console.error("catalog sync:", e); }

  const summary: { checked: number; newListings: number; notified: number; sources: boolean } = {
    checked: 0,
    newListings: 0,
    notified: 0,
    sources: sourcesAvailable(),
  };
  if (!summary.sources) return summary; // no sources configured (need GEMINI_API_KEY and/or eBay)

  const { rows } = await query("SELECT * FROM mugs WHERE status = 'wishlist'");
  summary.checked = rows.length;

  // Fresh finds are grouped per owner so each user is only told about their own mugs.
  const foundByOwner = new Map<string, { mugName: string; count: number }[]>();

  for (const row of rows) {
    const owner = (row.owner as string) || null;
    const mug = rowToMug(row);
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
    if (fresh > 0 && owner) {
      const list = foundByOwner.get(owner) || [];
      list.push({ mugName: mug.name, count: fresh });
      foundByOwner.set(owner, list);
    }
    summary.newListings += fresh;
  }

  if (foundByOwner.size && pushConfigured()) {
    for (const [owner, found] of foundByOwner) {
      const total = found.reduce((a, b) => a + b.count, 0);
      const names = found.map((f) => f.mugName).slice(0, 3).join(", ");
      summary.notified += await sendToOwner(owner, {
        title: "New Moomin mug listings found! 🫖",
        body: `${total} new listing${total === 1 ? "" : "s"} for ${names}${found.length > 3 ? "…" : ""}. Tap to view.`,
        url: "/?tab=wishlist",
      });
    }
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
