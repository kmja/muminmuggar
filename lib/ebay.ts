import type { Listing } from "./types";

let tokenCache: { token: string; expires: number } | null = null;

function creds(): { id: string; secret: string } | null {
  const id = process.env.EBAY_CLIENT_ID;
  const secret = process.env.EBAY_CLIENT_SECRET;
  if (!id || !secret) return null;
  return { id, secret };
}

export function ebayConfigured(): boolean {
  return creds() !== null;
}

async function getToken(): Promise<string | null> {
  const c = creds();
  if (!c) return null;
  if (tokenCache && tokenCache.expires > Date.now() + 60_000) return tokenCache.token;

  const basic = Buffer.from(`${c.id}:${c.secret}`).toString("base64");
  const res = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${basic}` },
    body: "grant_type=client_credentials&scope=" + encodeURIComponent("https://api.ebay.com/oauth/api_scope"),
  });
  if (!res.ok) throw new Error(`eBay auth failed: ${res.status}`);
  const data = await res.json();
  tokenCache = { token: data.access_token, expires: Date.now() + (Number(data.expires_in || 7200) * 1000) };
  return tokenCache.token;
}

interface EbayItem {
  title?: string;
  itemWebUrl?: string;
  price?: { value?: string; currency?: string };
  image?: { imageUrl?: string };
  condition?: string;
}

export async function searchEbay(q: string, limit = 15): Promise<Listing[]> {
  const token = await getToken();
  if (!token) return [];
  const marketplace = process.env.EBAY_MARKETPLACE_ID || "EBAY_GB";
  const url =
    `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(q)}&limit=${limit}` +
    `&filter=${encodeURIComponent("buyingOptions:{FIXED_PRICE|AUCTION}")}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, "X-EBAY-C-MARKETPLACE-ID": marketplace },
  });
  if (!res.ok) throw new Error(`eBay search failed: ${res.status}`);
  const data = await res.json();
  const items: EbayItem[] = data?.itemSummaries || [];
  return items
    .filter((i) => i.itemWebUrl && i.title)
    .map((i) => ({
      source: "eBay",
      title: i.title as string,
      price: i.price?.value != null ? Number(i.price.value) : null,
      currency: i.price?.currency ?? null,
      url: i.itemWebUrl as string,
      imageUrl: i.image?.imageUrl ?? null,
      condition: i.condition ?? null,
    }));
}
