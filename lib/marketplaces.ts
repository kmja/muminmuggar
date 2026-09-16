import type { Listing, Mug } from "./types";
import { ebayConfigured, searchEbay } from "./ebay";
import { traderaConfigured, searchTradera } from "./tradera";
import { geminiConfigured, searchSiteListings } from "./gemini";
import MASTER_CATALOG from "./master-catalog.json";

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

/* --------------------------- name localization --------------------------- */
// Stored mug names are the English catalogue names; Tradera is a Swedish site,
// so searches there should use the Swedish catalogue name.
type MasterEntry = { nameEn: string; nameSv?: string };

const foldC = (s: unknown): string =>
  (s == null ? "" : String(s))
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’`]/g, "")
    .replace(/\bmumin/g, "moomin")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const SV_BY_EN = new Map<string, string>(
  (MASTER_CATALOG as MasterEntry[])
    .filter((e) => e.nameSv)
    .map((e) => [foldC(e.nameEn), String(e.nameSv)] as const),
);

/** The catalogue's Swedish name for an English mug name, when known. */
export function localizedName(name: string | null | undefined, lang: "sv" | "en" = "sv"): string {
  if (!name) return "";
  return lang === "sv" ? SV_BY_EN.get(foldC(name)) || name : name;
}

// Words too generic to identify a mug on their own.
const NAME_STOP = new Set(["mug", "mugg", "moomin", "mumin", "arabia", "the", "and", "with", "of", "in", "on", "a", "x"]);

/** Does a listing title plausibly refer to this mug? (Precision filter for broad search hits.) */
export function listingMatches(title: string, name: string | null | undefined): boolean {
  const f = foldC(name);
  if (!f || !title) return false;
  const padded = ` ${foldC(title)} `;
  if (padded.includes(` ${f} `)) return true; // whole-name phrase
  const toks = f.split(" ").filter((x) => x && !NAME_STOP.has(x));
  return toks.length > 0 && toks.every((x) => padded.includes(` ${x} `));
}

/** Build a focused marketplace search query for a mug, in the given language. */
export function mugQuery(mug: Pick<Mug, "name" | "series" | "year">, lang: "sv" | "en" = "sv"): string {
  const name = localizedName(mug.name, lang)
    .replace(/\b(mug|mugg)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const tail = lang === "en" ? "Moomin mug" : "mumin mugg";
  return [name, tail].filter(Boolean).join(" ").trim();
}

/**
 * Aggregate marketplace search used by the on-demand "Deals" view and the
 * scheduled notifier. eBay is a structured source (real price/image);
 * the Swedish marketplaces + retailers are searched per-domain via Gemini
 * grounding. All results are normalized to the same Listing shape and
 * de-duplicated by URL.
 */
export async function searchMarketplaces(mug: Pick<Mug, "name" | "series" | "year">): Promise<Listing[]> {
  const structured: Listing[] = [];

  if (ebayConfigured()) {
    try {
      structured.push(...(await searchEbay(mugQuery(mug, "en"))));
    } catch (e) {
      console.error("eBay search error:", e);
    }
  }

  if (traderaConfigured()) {
    try {
      structured.push(...(await searchTradera(mugQuery(mug, "sv"))));
    } catch (e) {
      console.error("Tradera search error:", e);
    }
  }

  // Tradera's keyword search is broad (a generic name can return dozens of
  // unrelated mugs), so keep only titles that actually name this mug.
  const svName = localizedName(mug.name, "sv");
  const relevant = structured.filter((l) => listingMatches(l.title, mug.name) || listingMatches(l.title, svName));

  // Domain-restricted web search — already scoped, so no title filter.
  const web: Listing[] = [];
  if (geminiConfigured()) {
    const q = mugQuery(mug, "sv");
    const perSite = await Promise.all(
      SITE_SOURCES.map((s) =>
        searchSiteListings(q, s.domain, s.name).catch((e) => {
          console.error(`${s.name} search error:`, e);
          return [] as Listing[];
        }),
      ),
    );
    for (const list of perSite) web.push(...list);
  }

  const seen = new Set<string>();
  return [...relevant, ...web].filter((l) => (seen.has(l.url) ? false : (seen.add(l.url), true)));
}

/** True if we have at least one source to poll for the notifier. */
export function sourcesAvailable(): boolean {
  return ebayConfigured() || traderaConfigured() || geminiConfigured();
}
