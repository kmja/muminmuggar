import type { Listing, Mug } from "./types";
import { ebayConfigured, searchEbay } from "./ebay";

/** Build a focused search query for a wishlisted mug. */
export function mugQuery(mug: Pick<Mug, "name" | "series" | "year">): string {
  return [mug.name, mug.series, mug.year, "Moomin mug"].filter(Boolean).join(" ").trim();
}

/**
 * Structured marketplace search used by the scheduled notifier.
 * eBay is the reliable, structured backbone (real listings with IDs/URLs to dedupe).
 * Additional structured sources can be added here behind the same Listing shape.
 */
export async function searchMarketplaces(mug: Pick<Mug, "name" | "series" | "year">): Promise<Listing[]> {
  const q = mugQuery(mug);
  const results: Listing[] = [];
  if (ebayConfigured()) {
    try {
      results.push(...(await searchEbay(q)));
    } catch (e) {
      console.error("eBay search error:", e);
    }
  }
  // De-dupe by URL.
  const seen = new Set<string>();
  return results.filter((l) => (seen.has(l.url) ? false : (seen.add(l.url), true)));
}

export function anyStructuredSource(): boolean {
  return ebayConfigured();
}
