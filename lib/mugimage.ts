import type { Listing, Mug } from "./types";
import { ebayConfigured, searchEbay } from "./ebay";
import { traderaConfigured, searchTradera } from "./tradera";
import { geminiConfigured, findOfficialImageCandidates } from "./gemini";
import { mugQuery } from "./marketplaces";

const firstImage = (ls: Listing[]) => ls.find((l) => l.imageUrl)?.imageUrl ?? null;
const IMG_EXT = /\.(jpe?g|png|webp|avif)(\?|#|$)/i;

/** Fetch a page and extract its canonical image (og:image / twitter:image). */
async function pageImage(pageUrl: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(pageUrl, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; MoominMugs/1.0; +https://vercel.app)", accept: "text/html" },
      redirect: "follow",
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));
    if (!res.ok) return null;
    if (!(res.headers.get("content-type") || "").includes("text/html")) return null;
    const html = (await res.text()).slice(0, 200_000);
    const pick = (re: RegExp) => { const m = re.exec(html); return m ? m[1] : null; };
    let img =
      pick(/<meta[^>]+property=["']og:image(?::secure_url|:url)?["'][^>]+content=["']([^"']+)["']/i) ||
      pick(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i) ||
      pick(/<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["']/i) ||
      pick(/<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["']/i);
    if (!img) return null;
    try { img = new URL(img.replace(/&amp;/g, "&"), pageUrl).toString(); } catch { /* keep as-is */ }
    return img;
  } catch {
    return null;
  }
}

/** Confirm a URL actually serves an image (best effort — tolerant of hosts that block HEAD). */
async function isImage(url: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(url, { method: "HEAD", redirect: "follow", signal: controller.signal }).finally(() => clearTimeout(timer));
    if (!res.ok) return IMG_EXT.test(url); // some CDNs 405 on HEAD — trust the extension
    return (res.headers.get("content-type") || "").startsWith("image/");
  } catch {
    return IMG_EXT.test(url);
  }
}

/**
 * Find the official product image for a mug. Uses Gemini grounded search to
 * locate the official/retailer product page, then extracts its canonical
 * (og:image) catalog photo — the high-quality "official" image. Falls back to
 * a structured marketplace listing photo only if no official image is found.
 */
export async function findMugImage(mug: Pick<Mug, "name" | "series" | "year">): Promise<string | null> {
  const q = mugQuery(mug);

  if (geminiConfigured()) {
    try {
      const { imageUrls, pageUrls } = await findOfficialImageCandidates(q);
      // 1. Canonical image from an official/retailer product page (most reliable).
      for (const page of pageUrls.slice(0, 4)) {
        const og = await pageImage(page);
        if (og && (await isImage(og))) return og;
      }
      // 2. A direct image URL the model surfaced, if it really is an image.
      for (const u of imageUrls.slice(0, 6)) {
        if (await isImage(u)) return u;
      }
    } catch (e) {
      console.error("mug-image official lookup:", e);
    }
  }

  // 3. Last resort: a real photo from a structured marketplace listing.
  if (ebayConfigured()) {
    try { const img = firstImage(await searchEbay(q, 5)); if (img) return img; } catch (e) { console.error("mug-image eBay:", e); }
  }
  if (traderaConfigured()) {
    try { const img = firstImage(await searchTradera(q)); if (img) return img; } catch (e) { console.error("mug-image Tradera:", e); }
  }
  return null;
}
