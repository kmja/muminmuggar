import { query } from "./db";
import type { Mug } from "./types";

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
    .replace(/\bmumin/g, "moomin")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Shopify stores to sync from (comma-separated domains via env, else the official shop). */
function stores(): string[] {
  return (process.env.CATALOG_STORES || "shop.moomin.com")
    .split(",")
    .map((s) => s.trim().replace(/^https?:\/\//, "").replace(/\/$/, ""))
    .filter(Boolean);
}

const isMug = (title: string, type: string, tags: string) =>
  /\bmugg?s?\b|\bmuki\b|\bbecher\b|\bmok\b/i.test(`${title} ${type} ${tags}`);

interface ShopifyProduct {
  title?: string;
  handle?: string;
  product_type?: string;
  tags?: string[] | string;
  images?: { src?: string }[];
}

let syncing: Promise<number> | null = null;
let cache: { rows: CatalogRow[]; at: number } | null = null;

/** Fetch + upsert the official catalog. Idempotent; safe to call repeatedly. */
export async function syncCatalog(): Promise<number> {
  let upserted = 0;
  for (const domain of stores()) {
    for (let page = 1; page <= 12; page++) {
      let products: ShopifyProduct[] = [];
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 9000);
        const res = await fetch(`https://${domain}/products.json?limit=250&page=${page}`, {
          headers: { accept: "application/json", "user-agent": "MoominMugs/1.0" },
          signal: controller.signal,
        }).finally(() => clearTimeout(timer));
        if (!res.ok) break;
        const data = await res.json();
        products = Array.isArray(data?.products) ? data.products : [];
      } catch (e) {
        console.error(`catalog sync ${domain} p${page}:`, e);
        break;
      }
      if (!products.length) break;

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
        upserted++;
      }
      if (products.length < 250) break; // last page
    }
  }
  cache = null; // invalidate
  return upserted;
}

/** Run at most one sync at a time. */
export function syncCatalogOnce(): Promise<number> {
  if (!syncing) syncing = syncCatalog().finally(() => { syncing = null; });
  return syncing;
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

function score(mug: Pick<Mug, "name" | "series" | "year">, row: CatalogRow): number {
  const name = fold(mug.name);
  if (!name) return 0;
  const nameTokens = name.split(" ").filter((t) => t.length > 2);
  const hasName = row.norm.includes(name) || (nameTokens.length > 0 && nameTokens.every((t) => row.norm.includes(t)));
  if (!hasName) return 0;
  let s = 10;
  if (mug.year && row.year) s += Number(mug.year) === Number(row.year) ? 6 : -3;
  if (mug.series) {
    const st = fold(mug.series).split(" ").filter((t) => t.length > 2);
    s += st.filter((t) => row.norm.includes(t)).length;
  }
  s -= row.norm.length / 300; // prefer the most specific (shortest) matching title
  return s;
}

/** Best-matching official image for a mug, from our stored catalog. No web/Gemini calls. */
export async function catalogImage(mug: Pick<Mug, "name" | "series" | "year">): Promise<string | null> {
  let rows = await cachedRows();
  if (!rows.length) {
    try { await syncCatalogOnce(); } catch { /* ignore */ }
    rows = await cachedRows();
  }
  let best: CatalogRow | null = null;
  let bestScore = 9.5; // require a real name match
  for (const r of rows) {
    const sc = score(mug, r);
    if (sc > bestScore) { bestScore = sc; best = r; }
  }
  return best?.imageUrl ?? null;
}
