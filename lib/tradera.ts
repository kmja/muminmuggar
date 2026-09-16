import { XMLParser } from "fast-xml-parser";
import type { Listing } from "./types";

/**
 * Tradera SearchService (SOAP API v3, stable).
 * Docs: https://api.tradera.com/llms.txt · WSDL: https://api.tradera.com/v3/SearchService.asmx?WSDL
 *
 * Auth is app-level only (AppId + AppKey) — no user token needed for search.
 * The same credentials work with the beta REST API v4 (`GET /v4/search`) if we
 * ever migrate; see the note at the bottom of this file.
 */
const ENDPOINT = "https://api.tradera.com/v3/SearchService.asmx";
const NS = "http://api.tradera.com";

export function traderaConfigured(): boolean {
  return Boolean(process.env.TRADERA_APP_ID && process.env.TRADERA_APP_KEY);
}

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c] as string));
}

function envelope(query: string): string {
  const appId = String(process.env.TRADERA_APP_ID || "").trim();
  const appKey = String(process.env.TRADERA_APP_KEY || "").trim();
  // Sandbox was retired by Tradera; ConfigurationHeader is still required, so we
  // always send Sandbox=0 (production). MaxResultAge=0 returns the freshest data.
  return (
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:t="${NS}">` +
    `<soap:Header>` +
    `<t:AuthenticationHeader><t:AppId>${escapeXml(appId)}</t:AppId><t:AppKey>${escapeXml(appKey)}</t:AppKey></t:AuthenticationHeader>` +
    `<t:ConfigurationHeader><t:Sandbox>0</t:Sandbox><t:MaxResultAge>0</t:MaxResultAge></t:ConfigurationHeader>` +
    `</soap:Header>` +
    `<soap:Body>` +
    `<t:Search><t:query>${escapeXml(query)}</t:query><t:categoryId>0</t:categoryId><t:pageNumber>1</t:pageNumber><t:orderBy>Relevance</t:orderBy></t:Search>` +
    `</soap:Body></soap:Envelope>`
  );
}

const parser = new XMLParser({ ignoreAttributes: true, removeNSPrefix: true, parseTagValue: false });

function toNum(v: unknown): number | null {
  if (v == null || typeof v === "object") return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}
function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : v == null ? [] : [v as T];
}
function text(v: unknown): string {
  return v == null ? "" : typeof v === "object" ? "" : String(v);
}
function toInt(v: unknown): number | null {
  if (v == null || typeof v === "object") return null;
  const n = Number(String(v));
  return Number.isFinite(n) ? n : null;
}
/** Best available image (prefer the "normal" size over the tiny thumbnail). */
function pickImage(e: Record<string, unknown>): string | null {
  const links = asArray<Record<string, unknown>>((e.ImageLinks as { ImageLink?: unknown } | undefined)?.ImageLink);
  const byFormat = (f: string) => links.find((x) => String(x.Format).toLowerCase() === f);
  return text(byFormat("normal")?.Url) || text(byFormat("medium")?.Url) || text(e.ThumbnailLink) || null;
}
/** Tradera's "Skick" (condition) attribute, e.g. "Oanvänt". */
function pickCondition(e: Record<string, unknown>): string | null {
  const attrs = (e.AttributeValues as { TermAttributeValues?: { TermAttributeValue?: unknown } } | undefined)
    ?.TermAttributeValues?.TermAttributeValue;
  for (const tv of asArray<Record<string, unknown>>(attrs)) {
    if (String(tv.Name).toLowerCase() === "condition") {
      const vals = asArray<unknown>((tv.Values as { string?: unknown } | undefined)?.string).map(text).filter(Boolean);
      if (vals.length) return vals.join(", ");
    }
  }
  return null;
}

/**
 * Parse a SearchService.Search SOAP response into normalized Listings.
 * Shape (from the WSDL): Envelope/Body/SearchResponse/SearchResult with a repeated
 * `Items` element of type SearchItem, plus TotalNumberOfItems/Pages and Errors.
 */
export function parseTraderaResponse(xml: string): Listing[] {
  const doc = parser.parse(xml);
  const body = doc?.Envelope?.Body;
  if (body?.Fault) {
    const msg = body.Fault.faultstring || body.Fault.Reason?.Text || body.Fault.detail || "Tradera SOAP fault";
    throw new Error(String(msg));
  }
  const result = body?.SearchResponse?.SearchResult;
  if (!result) return [];

  // Tradera can return a 200 with a logical error in SearchResult.Errors.
  const errors = asArray<Record<string, unknown>>(result.Errors)
    .map((e) => [text(e.Code), text(e.Message)].filter(Boolean).join(": "))
    .filter(Boolean);

  const listings = asArray<Record<string, unknown>>(result.Items)
    .filter((e) => String(e.IsEnded).toLowerCase() !== "true")
    .map((e) => {
      const id = text(e.Id);
      const hasBids = String(e.HasBids).toLowerCase() === "true";
      const bidCount = toInt(e.BidCount);
      const buyItNow = toNum(e.BuyItNowPrice);
      const maxBid = toNum(e.MaxBid);
      const nextBid = toNum(e.NextBid);
      // With bids, MaxBid is the current highest bid; without, MaxBid/NextBid are
      // the start price. `price` is the most relevant headline number.
      const currentBid = hasBids ? maxBid : null;
      const startPrice = hasBids ? null : nextBid ?? maxBid;
      const price = currentBid ?? buyItNow ?? startPrice ?? maxBid ?? nextBid;
      const url = (
        text(e.ItemUrl) ||
        (id ? `https://www.tradera.com/item/${id}` : "https://www.tradera.com")
      ).replace(/^http:\/\//i, "https://"); // Tradera returns http:// item links
      return {
        source: "Tradera",
        title: text(e.ShortDescription) || "Tradera listing",
        price,
        currency: price != null ? "SEK" : null,
        url,
        imageUrl: pickImage(e),
        condition: pickCondition(e),
        endDate: text(e.EndDate) || null,
        bidCount,
        currentBid,
        buyItNow,
        startPrice,
        seller: text(e.SellerAlias) || null,
        itemType: text(e.ItemType) || null,
      } as Listing;
    })
    .filter((l) => Boolean(l.title));

  // No usable listings + a logical error -> surface it so the caller can log it.
  if (!listings.length && errors.length) throw new Error(`Tradera: ${errors.join("; ")}`);
  return listings;
}

export async function searchTradera(query: string): Promise<Listing[]> {
  if (!traderaConfigured()) return [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: `${NS}/Search` },
      body: envelope(query),
      signal: controller.signal,
    });
    const xml = await res.text();
    // SOAP faults also come back as HTTP 500 with a Fault body — parse first.
    if (!res.ok && !xml.includes("Fault")) throw new Error(`Tradera HTTP ${res.status}`);
    return parseTraderaResponse(xml);
  } finally {
    clearTimeout(timer);
  }
}
