import { query } from "./db";
import type { Mug } from "./types";
import seed from "./catalog-seed.json";
import masterCatalog from "./master-catalog.json";

type MasterEntry = {
  num: number; nameEn: string; year: number | null; years: string; capacity: string;
  estLow: number | null; estHigh: number | null; estCur: string; image: string | null; norm: string;
};

/**
 * A stored catalog of official Moomin product images. We populate it once from
 * the official shop's structured product feed and then serve mug images from
 * our own database — no per-mug web/Gemini searches.
 */

export interface CatalogRow {
  title: string;
  series: string | null;
  year: number | null;
  imageUrl: string;
  norm: string;
}

/** Normalize text for matching: lowercase, fold accents, unify Moomin spellings. */
export function fold(s: unknown): string {
  return (s == null ? "" : String(s))
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’`]/g, "")          // moomin's -> moomins (matches our slugs)
    .replace(/\bmumin/g, "moomin")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Shopify stores to sync from (comma-separated domains via env, else known Moomin shops). */
function stores(): string[] {
  return (process.env.CATALOG_STORES || "shop.moomin.com,www.moominarabia.com")
    .split(",")
    .map((s) => s.trim().replace(/^https?:\/\//, "").replace(/\/$/, ""))
    .filter(Boolean);
}

// A realistic browser User-Agent so the retailer CDN/Cloudflare serves the feed.
const BROWSER_HEADERS = {
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
  accept: "application/json,text/plain,*/*",
  "accept-language": "en-US,en;q=0.9",
};

const isMug = (title: string, type: string, tags: string) =>
  /\bmugg?s?\b|\bmuki\b|\bbecher\b|\bmok\b/i.test(`${title} ${type} ${tags}`);

interface ShopifyProduct {
  title?: string;
  handle?: string;
  product_type?: string;
  tags?: string[] | string;
  images?: { src?: string }[];
}

export interface SyncResult {
  upserted: number;
  stores: { domain: string; mugs: number; products: number; status?: number; error?: string }[];
}

let syncing: Promise<SyncResult> | null = null;
let cache: { rows: CatalogRow[]; at: number } | null = null;

/** Load the bundled seed of official product images (self-hosted under /mugs). */
export async function loadSeed(): Promise<number> {
  let n = 0;
  for (const s of seed as { name: string; year: number | null; capacity: string; image: string; norm: string }[]) {
    await query(
      `INSERT INTO catalog_mugs (id, title, series, year, image_url, source, source_url, norm, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now())
       ON CONFLICT (id) DO UPDATE SET
         title = EXCLUDED.title, year = EXCLUDED.year, image_url = EXCLUDED.image_url, norm = EXCLUDED.norm, updated_at = now()`,
      [`seed:${s.image}`, s.name, s.capacity || null, s.year, s.image, "moomin.com", null, s.norm],
    );
    n++;
  }
  cache = null;
  return n;
}

/** Fetch + upsert the official catalog. Idempotent; safe to call repeatedly. */
export async function syncCatalog(): Promise<SyncResult> {
  const result: SyncResult = { upserted: 0, stores: [] };

  // The bundled seed of self-hosted official images is the primary source.
  try {
    const seeded = await loadSeed();
    result.upserted += seeded;
    result.stores.push({ domain: "bundled-seed", mugs: seeded, products: seeded });
  } catch (e) {
    result.stores.push({ domain: "bundled-seed", mugs: 0, products: 0, error: (e as Error).message });
  }
  for (const domain of stores()) {
    const stat = { domain, mugs: 0, products: 0, status: undefined as number | undefined, error: undefined as string | undefined };
    result.stores.push(stat);
    for (let page = 1; page <= 12; page++) {
      let products: ShopifyProduct[] = [];
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 9000);
        const res = await fetch(`https://${domain}/products.json?limit=250&page=${page}`, {
          headers: BROWSER_HEADERS,
          signal: controller.signal,
        }).finally(() => clearTimeout(timer));
        stat.status = res.status;
        if (!res.ok) { stat.error = `HTTP ${res.status}`; break; }
        const data = await res.json();
        products = Array.isArray(data?.products) ? data.products : [];
      } catch (e) {
        stat.error = (e as Error).message;
        console.error(`catalog sync ${domain} p${page}:`, e);
        break;
      }
      if (!products.length) break;
      stat.products += products.length;

      for (const p of products) {
        const title = String(p.title || "").trim();
        const image = p.images?.find((i) => i.src)?.src;
        const type = String(p.product_type || "");
        const tags = Array.isArray(p.tags) ? p.tags.join(" ") : String(p.tags || "");
        if (!title || !image || !isMug(title, type, tags)) continue;
        const yearMatch = /\b(19|20)\d{2}\b/.exec(`${title} ${tags}`);
        const year = yearMatch ? Number(yearMatch[0]) : null;
        const id = `${domain}:${p.handle || fold(title).replace(/ /g, "-")}`;
        const sourceUrl = p.handle ? `https://${domain}/products/${p.handle}` : `https://${domain}`;
        const norm = fold(`${title} ${tags}`);
        await query(
          `INSERT INTO catalog_mugs (id, title, series, year, image_url, source, source_url, norm, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now())
           ON CONFLICT (id) DO UPDATE SET
             title = EXCLUDED.title, year = EXCLUDED.year, image_url = EXCLUDED.image_url,
             source_url = EXCLUDED.source_url, norm = EXCLUDED.norm, updated_at = now()`,
          [id, title, null, year, image, domain, sourceUrl, norm],
        );
        result.upserted++;
        stat.mugs++;
      }
      if (products.length < 250) break; // last page
    }
  }
  cache = null; // invalidate
  return result;
}

/** Run at most one sync at a time. */
export function syncCatalogOnce(): Promise<SyncResult> {
  if (!syncing) syncing = syncCatalog().finally(() => { syncing = null; });
  return syncing;
}

let seeding: Promise<number> | null = null;
/** Load the bundled seed at most once at a time (fast, no network). */
export function loadSeedOnce(): Promise<number> {
  if (!seeding) seeding = loadSeed().finally(() => { seeding = null; });
  return seeding;
}

export async function catalogCount(): Promise<number> {
  const { rows } = await query<{ n: string }>("SELECT count(*)::text AS n FROM catalog_mugs");
  return Number(rows[0]?.n || 0);
}

async function cachedRows(): Promise<CatalogRow[]> {
  if (cache && Date.now() - cache.at < 5 * 60 * 1000) return cache.rows;
  const { rows } = await query<{ title: string; series: string | null; year: number | null; image_url: string; norm: string }>(
    "SELECT title, series, year, image_url, norm FROM catalog_mugs",
  );
  const mapped = rows.map((r) => ({ title: r.title, series: r.series, year: r.year == null ? null : Number(r.year), imageUrl: r.image_url, norm: r.norm }));
  cache = { rows: mapped, at: Date.now() };
  return mapped;
}

const STOP = new Set(["and", "the", "with", "of", "on", "in", "a", "mug", "moomin"]);
const words = (s: string) => ` ${s} `;
const stripParen = (s: unknown) => String(s || "").replace(/\(.*?\)/g, " ");

// A mug's identifying motif usually lives in `edition` (e.g. "Midsummer"),
// while `name` is the character list. Try the edition first, then the name.
type MugQ = Pick<Mug, "name" | "year"> & { edition?: string | null; series?: string | null };
const candidates = (mug: MugQ): string[] =>
  [stripParen(mug.edition), stripParen(mug.name)].map((s) => s.trim()).filter(Boolean);

/** Score a query name against a row's norm; all query tokens must appear as whole words. */
const sig = (norm: string) => norm.split(" ").filter((t) => t && !STOP.has(t) && !/^\d+$/.test(t) && !/^\d?l$/.test(t));

function scoreNorm(qName: string, year: number | null | undefined, rowNorm: string, rowYear: number | null): number {
  const toks = fold(qName).split(" ").filter((t) => t && !STOP.has(t));
  if (!toks.length) return 0;
  const nw = words(rowNorm);
  if (!toks.every((t) => nw.includes(words(t)))) return 0;
  let s = 10 + toks.length;
  // Penalise rows that carry extra descriptive words (so "Moominvalley" prefers
  // "Moominvalley" over "Moominvalley Park Japan").
  s -= sig(rowNorm).filter((t) => !toks.includes(t)).length * 1.5;
  // Year is a tiebreaker (helps pick the right seasonal), not a blocker —
  // Gemini's year can be off, and a name match is already a hard requirement.
  if (year && rowYear) s += Number(year) === Number(rowYear) ? 6 : -1;
  s -= rowNorm.length / 300;
  return s;
}

// Catalogue values are quoted in EUR; the app works in SEK by default.
const EUR_SEK = Number(process.env.EUR_SEK_RATE) || 11.3;
const toSek = (eur: number | null): number | null => (eur == null ? null : Math.round((eur * EUR_SEK) / 10) * 10);

/** The full authoritative catalogue (196 Arabia mugs) with baked-in images + values (SEK). */
export async function listMasterCatalog(): Promise<MasterEntry[]> {
  return (masterCatalog as MasterEntry[]).map((e) => ({ ...e, estLow: toSek(e.estLow), estHigh: toSek(e.estHigh), estCur: "SEK" }));
}

/** Parse a "1999–2013" / "2005-" / "2016" production span into [lo, hi]. */
function parseYears(years: string): [number, number] {
  const nums = (String(years).match(/(?:19|20)\d{2}/g) || []).map(Number);
  if (!nums.length) return [0, 0];
  const open = /[-–]\s*$/.test(String(years));
  return [Math.min(...nums), open ? 9999 : Math.max(...nums)];
}

/**
 * Last-resort match on the primary character + production span — for scanned
 * mugs whose motif Gemini got wrong but whose lead character + year still pin
 * down a classic mug (e.g. "Moominpappa, …" 2006 → "Moominpappa Thinking").
 */
function matchByCharacter(mug: MugQ): MasterEntry | null {
  const first = fold(mug.name).split(" ").filter((t) => t && !STOP.has(t))[0];
  if (!first || first.length < 3) return null;
  const y = Number(mug.year) || 0;
  let best: MasterEntry | null = null, bs = 0;
  for (const e of masterCatalog as MasterEntry[]) {
    const et = fold(e.nameEn).split(" ").filter((t) => t && !STOP.has(t));
    if (et[0] !== first) continue;                       // catalogue name must lead with that character
    const [lo, hi] = parseYears(e.years);
    const inRange = y && lo && y >= lo && y <= hi;
    const s = 5 + (inRange ? 5 : 0) - et.length * 0.5;   // prefer in-range, simplest name
    if (s > bs) { bs = s; best = e; }
  }
  return best;
}

/** Best-matching master-catalogue entry for a mug (edition → name → character). */
function matchMaster(mug: MugQ): MasterEntry | null {
  for (const q of candidates(mug)) {
    let best: MasterEntry | null = null, bs = 9.5;
    for (const e of masterCatalog as MasterEntry[]) {
      const s = scoreNorm(q, mug.year, e.norm, e.year);
      if (s > bs) { bs = s; best = e; }
    }
    if (best) return best;
  }
  return matchByCharacter(mug);
}

/** Authoritative production year for a mug (for filling in missing years). */
export function catalogYear(mug: MugQ): number | null {
  return matchMaster(mug)?.year ?? null;
}

/** Authoritative market-value range (SEK) for a mug, from the catalogue. */
export function catalogValue(mug: MugQ): { low: number | null; high: number | null; cur: string } | null {
  const m = matchMaster(mug);
  if (!m || (m.estLow == null && m.estHigh == null)) return null;
  return { low: toSek(m.estLow), high: toSek(m.estHigh), cur: "SEK" };
}

/** Best-matching official image for a mug, from our stored catalog. No web/Gemini calls. */
export async function catalogImage(mug: MugQ): Promise<string | null> {
  let rows = await cachedRows();
  if (!rows.length) {
    try { await loadSeedOnce(); } catch { /* ignore */ }
    rows = await cachedRows();
  }
  for (const q of candidates(mug)) {
    let best: CatalogRow | null = null, bs = 9.5;
    for (const r of rows) {
      const s = scoreNorm(q, mug.year, r.norm, r.year);
      if (s > bs) { bs = s; best = r; }
    }
    if (best) return best.imageUrl;
  }
  return matchByCharacter(mug)?.image ?? null;
}
