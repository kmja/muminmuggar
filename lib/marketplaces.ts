import type { Listing, Mug } from "./types";
import { ebayConfigured, searchEbay } from "./ebay";
import { traderaConfigured, searchTradera } from "./tradera";
import { geminiConfigured, searchSiteListings } from "./gemini";

/**
 * Secondhand marketplaces searched via Gemini grounding (no public API).
 * Tradera and eBay are handled by their official APIs instead — see below.
 */
export const MARKETPLACES = [
  { name: "Blocket", domain: "blocket.se" },
  { name: "Facebook Marketplace", domain: "facebook.com/marketplace" },
];

/** Retailers searched for wishlisted mugs. */
export const RETAILERS = [
  { name: "Arabia", domain: "arabia.com" },
  { name: "Cervera", domain: "cervera.se" },
];

/** Sites searched via Gemini Google-Search grounding (no public API available). */
export const SITE_SOURCES = [...MARKETPLACES, ...RETAILERS];

/** Build a focused search query for a wishlisted mug. */
export function mugQuery(mug: Pick<Mug, "name" | "series" | "year">): string {
  return [mug.name, mug.series, mug.year, "Moomin mug"].filter(Boolean).join(" ").trim();
}

/**
 * Aggregate marketplace search used by the on-demand "Deals" view and the
 * scheduled notifier. eBay is a structured source (real price/image);
 * the Swedish marketplaces + retailers are searched per-domain via Gemini
 * grounding. All results are normalized to the same Listing shape and
 * de-duplicated by URL.
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

  if (traderaConfigured()) {
    try {
      results.push(...(await searchTradera(q)));
    } catch (e) {
      console.error("Tradera search error:", e);
    }
  }

  if (geminiConfigured()) {
    const perSite = await Promise.all(
      SITE_SOURCES.map((s) =>
        searchSiteListings(q, s.domain, s.name).catch((e) => {
          console.error(`${s.name} search error:`, e);
          return [] as Listing[];
        }),
      ),
    );
    for (const list of perSite) results.push(...list);
  }

  const seen = new Set<string>();
  return results.filter((l) => (seen.has(l.url) ? false : (seen.add(l.url), true)));
}

/** True if we have at least one source to poll for the notifier. */
export function sourcesAvailable(): boolean {
  return ebayConfigured() || traderaConfigured() || geminiConfigured();
}
