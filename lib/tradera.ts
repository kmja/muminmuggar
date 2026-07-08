import { XMLParser } from "fast-xml-parser";
import type { Listing } from "./types";

const ENDPOINT = "https://api.tradera.com/v3/searchservice.asmx";
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
  const sandbox = process.env.TRADERA_SANDBOX === "1" ? "1" : "0";
  return (
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:t="${NS}">` +
    `<soap:Header>` +
    `<t:AuthenticationHeader><t:AppId>${escapeXml(appId)}</t:AppId><t:AppKey>${escapeXml(appKey)}</t:AppKey></t:AuthenticationHeader>` +
    `<t:ConfigurationHeader><t:Sandbox>${sandbox}</t:Sandbox><t:MaxResultAge>0</t:MaxResultAge></t:ConfigurationHeader>` +
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
function asArray<T>(v: T | T[] | undefined | null): T[] {
  return Array.isArray(v) ? v : v == null ? [] : [v];
}

/** Parse a SearchService.Search SOAP response into normalized Listings. */
export function parseTraderaResponse(xml: string): Listing[] {
  const doc = parser.parse(xml);
  const body = doc?.Envelope?.Body;
  if (body?.Fault) {
    const msg = body.Fault.faultstring || body.Fault.Reason?.Text || "Tradera SOAP fault";
    throw new Error(String(msg));
  }
  const result = body?.SearchResponse?.SearchResult;
  const entries = asArray<Record<string, unknown>>(result?.Items?.SearchResultEntry);
  return entries
    .filter((e) => String(e.IsEnded).toLowerCase() !== "true")
    .map((e) => {
      const id = e.Id != null ? String(e.Id) : "";
      const price = toNum(e.BuyItNowPrice) ?? toNum(e.NextBid) ?? toNum(e.MaxBid);
      const thumb = typeof e.ThumbnailLink === "string" ? e.ThumbnailLink : null;
      return {
        source: "Tradera",
        title: String(e.ShortDescription || "Tradera listing"),
        price,
        currency: price != null ? "SEK" : null,
        url: id ? `https://www.tradera.com/item/${id}` : "https://www.tradera.com",
        imageUrl: thumb,
        condition: null,
      } as Listing;
    })
    .filter((l) => Boolean(l.title));
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
    const text = await res.text();
    if (!res.ok && !text.includes("Fault")) throw new Error(`Tradera HTTP ${res.status}`);
    return parseTraderaResponse(text);
  } finally {
    clearTimeout(timer);
  }
}
