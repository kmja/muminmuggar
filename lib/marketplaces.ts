import type { Listing, Mug } from "./types";
import { traderaConfigured, searchTradera } from "./tradera";
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

// "moominmugg" -> "moomin mugg" so the name phrase "mugg rosa" matches inside it.
const foldT = (s: unknown): string => foldC(s).replace(/([a-z])mugg?\b/g, "$1 mugg");

/** Match a folded name against a folded title: 100 for the name phrase, 55 for all
 *  name tokens present, minus a small penalty for extra descriptive words. */
function matchFolded(tf: string, f: string): number {
  if (!f || !tf) return 0;
  const toks = f.split(" ").filter((x) => x && !NAME_STOP.has(x));
  if (!toks.length) return 0;
  const padded = ` ${tf} `;
  const phrase = padded.includes(` ${f} `);
  const allToks = toks.every((x) => padded.includes(` ${x} `));
  if (!phrase && !allToks) return 0;
  const extra = tf.split(" ").filter((x) => x && !NAME_STOP.has(x) && !toks.includes(x)).length;
  return (phrase ? 100 : 55) - extra * 2;
}

// Folded catalogue names, to find which mug a listing title is *really* about.
const CATALOG_FOLDED = (MASTER_CATALOG as MasterEntry[]).map((e) => ({
  en: foldT(e.nameEn),
  sv: e.nameSv ? foldT(e.nameSv) : "",
}));

function bestCatalogMatch(tf: string): number {
  let best = 0;
  for (const n of CATALOG_FOLDED) {
    const s = Math.max(matchFolded(tf, n.en), n.sv ? matchFolded(tf, n.sv) : 0);
    if (s > best) best = s;
  }
  return best;
}

/**
 * Relevance of a listing title to a mug (0 = not this mug, or a *different*
 * catalogue mug matches the title better). This is how we drop broad Tradera
 * hits like "Muminmugg Snusmumriken (rosa)" when searching for "Mug Rose".
 */
export function titleScore(title: string, mug: Pick<Mug, "name">): number {
  const tf = foldT(title);
  if (!tf) return 0;
  const target = Math.max(matchFolded(tf, foldT(mug.name)), matchFolded(tf, foldT(localizedName(mug.name, "sv"))));
  if (target <= 0) return 0;
  return target >= bestCatalogMatch(tf) ? target : 0;
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
  const results: Listing[] = [];

  // Tradera only for now: structured, app-authenticated and quota-free. eBay and
  // the Gemini-grounded web search still live in ./ebay and ./gemini, but are not
  // polled until we re-enable them here.
  if (traderaConfigured()) {
    try {
      results.push(...(await searchTradera(mugQuery(mug, "sv"))));
    } catch (e) {
      console.error("Tradera search error:", e);
    }
  }

  // Tradera's keyword search is broad, so score each hit by title relevance, drop
  // the ones that don't name this mug (or name a different one) and best-match first.
  const seen = new Set<string>();
  return results
    .map((l) => ({ l, s: titleScore(l.title, mug) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.l)
    .filter((l) => (seen.has(l.url) ? false : (seen.add(l.url), true)));
}

/** True if we have at least one source to poll for the notifier. */
export function sourcesAvailable(): boolean {
  return traderaConfigured();
}
