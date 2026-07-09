import type { Listing, Mug } from "./types";
import { ebayConfigured, searchEbay } from "./ebay";
import { traderaConfigured, searchTradera } from "./tradera";
import { geminiConfigured, searchSiteListings } from "./gemini";
import { mugQuery } from "./marketplaces";

const firstImage = (ls: Listing[]) => ls.find((l) => l.imageUrl)?.imageUrl ?? null;

/**
 * Find a representative product image for a mug. Prefers structured sources
 * (eBay, Tradera) whose image CDNs are hotlink-friendly and free of quota
 * cost, falling back to Gemini grounded search on the official retailer.
 * Returns a direct image URL, or null if nothing usable was found.
 */
export async function findMugImage(mug: Pick<Mug, "name" | "series" | "year">): Promise<string | null> {
  const q = mugQuery(mug);

  if (ebayConfigured()) {
    try { const img = firstImage(await searchEbay(q, 5)); if (img) return img; } catch (e) { console.error("mug-image eBay:", e); }
  }
  if (traderaConfigured()) {
    try { const img = firstImage(await searchTradera(q)); if (img) return img; } catch (e) { console.error("mug-image Tradera:", e); }
  }
  if (geminiConfigured()) {
    for (const s of [{ domain: "arabia.com", name: "Arabia" }, { domain: "tradera.com", name: "Tradera" }]) {
      try { const img = firstImage(await searchSiteListings(q, s.domain, s.name)); if (img) return img; } catch (e) { console.error(`mug-image ${s.name}:`, e); }
    }
  }
  return null;
}
