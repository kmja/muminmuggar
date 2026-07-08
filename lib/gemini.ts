import type { AiMug, Listing } from "./types";

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

function model(): string {
  return (process.env.GEMINI_MODEL || "gemini-2.5-flash").trim();
}
function apiKey(): string {
  const k = process.env.GEMINI_API_KEY;
  if (!k) throw new Error("GEMINI_API_KEY is not set on the server.");
  return k;
}
export function geminiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}
function currency(): string {
  return process.env.DEFAULT_CURRENCY || "SEK";
}
function region(): string {
  return process.env.DEFAULT_REGION || "";
}

type Part = { text: string } | { inline_data: { mime_type: string; data: string } };

const MUG_PROPS = {
  isMoominMug: { type: "BOOLEAN" },
  character: { type: "STRING" },
  series: { type: "STRING" },
  edition: { type: "STRING" },
  year: { type: "INTEGER", nullable: true },
  condition: { type: "STRING" },
  conditionNotes: { type: "STRING" },
  estimatedValueLow: { type: "NUMBER", nullable: true },
  estimatedValueHigh: { type: "NUMBER", nullable: true },
  valueCurrency: { type: "STRING" },
  confidence: { type: "NUMBER" },
  notes: { type: "STRING" },
} as const;

const IDENTIFY_SYSTEM =
  "You are an expert on Moomin ceramics — especially Arabia (Finland) Moomin mugs, plus seasonal, limited and anniversary editions. " +
  "Identify Moomin mugs precisely from photographs. Read the artwork, character(s), illustration style, and any text/stamps. " +
  "Estimate secondhand market value as a low–high range in the requested currency, and note visible condition (chips, cracks, crazing, gilding wear, fading). " +
  "Give a confidence between 0 and 1. If the item is clearly not a Moomin mug, set isMoominMug=false. Never invent a year you cannot support — use null when unsure.";

interface GenOpts {
  parts: Part[];
  system?: string;
  schema?: unknown;
  useSearch?: boolean;
}

async function generate(opts: GenOpts): Promise<{ text: string; grounding: { title: string; uri: string }[] }> {
  const url = `${BASE}/${encodeURIComponent(model())}:generateContent?key=${encodeURIComponent(apiKey())}`;
  const body: Record<string, unknown> = { contents: [{ role: "user", parts: opts.parts }] };
  if (opts.system) body.systemInstruction = { parts: [{ text: opts.system }] };
  if (opts.schema && !opts.useSearch) {
    body.generationConfig = { responseMimeType: "application/json", responseSchema: opts.schema };
  }
  if (opts.useSearch) body.tools = [{ google_search: {} }];

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let msg = `Gemini ${res.status}`;
    try {
      const j = await res.json();
      msg = j?.error?.message || msg;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  const data = await res.json();
  const cand = data?.candidates?.[0];
  const text: string = (cand?.content?.parts || [])
    .map((p: { text?: string }) => p.text)
    .filter(Boolean)
    .join("");
  const chunks = cand?.groundingMetadata?.groundingChunks || [];
  const grounding = chunks
    .map((c: { web?: { uri?: string; title?: string } }) => c.web)
    .filter(Boolean)
    .map((w: { uri?: string; title?: string }) => ({ title: w.title || w.uri || "", uri: w.uri || "" }));
  return { text, grounding };
}

function parseJson<T>(text: string): T | null {
  let t = (text || "").trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  if (fence) t = fence[1].trim();
  const start = t.search(/[[{]/);
  if (start > 0) t = t.slice(start);
  try {
    return JSON.parse(t) as T;
  } catch {
    return null;
  }
}

function dataUrlParts(dataUrl: string): { mime: string; data: string } {
  const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl || "");
  if (m) return { mime: m[1], data: m[2] };
  return { mime: "image/jpeg", data: (dataUrl || "").split(",").pop() || "" };
}

export async function identifyMug(imageDataUrl: string): Promise<AiMug> {
  const { mime, data } = dataUrlParts(imageDataUrl);
  const prompt = `Identify this single Moomin mug. Estimate value in ${currency()}${region() ? ` for the ${region()} market` : ""}. Return JSON only.`;
  const schema = { type: "OBJECT", properties: MUG_PROPS, required: ["isMoominMug", "character", "confidence"] };
  const { text } = await generate({
    system: IDENTIFY_SYSTEM,
    schema,
    parts: [{ text: prompt }, { inline_data: { mime_type: mime, data } }],
  });
  const obj = parseJson<AiMug>(text);
  if (!obj) throw new Error("Could not parse Gemini's response.");
  return obj;
}

export async function identifyShelf(imageDataUrl: string): Promise<AiMug[]> {
  const { mime, data } = dataUrlParts(imageDataUrl);
  const prompt =
    `This photo shows a shelf/group of Moomin mugs. Identify EACH mug you can see as a separate entry, left-to-right, top-to-bottom. ` +
    `For each, describe its position (e.g. "top shelf, 2nd from left"). Estimate value in ${currency()}${region() ? ` for the ${region()} market` : ""}. Return JSON only.`;
  const schema = {
    type: "OBJECT",
    properties: {
      mugs: {
        type: "ARRAY",
        items: { type: "OBJECT", properties: { ...MUG_PROPS, position: { type: "STRING" } }, required: ["character", "confidence"] },
      },
    },
    required: ["mugs"],
  };
  const { text } = await generate({
    system: IDENTIFY_SYSTEM,
    schema,
    parts: [{ text: prompt }, { inline_data: { mime_type: mime, data } }],
  });
  const obj = parseJson<{ mugs?: AiMug[] }>(text);
  return obj?.mugs || [];
}

export interface CatalogEntry {
  character: string;
  year?: number | null;
  edition?: string;
  notes?: string;
}

export async function findSeriesMugs(series: string): Promise<CatalogEntry[]> {
  const prompt =
    `List the mugs released in the "${series}" Moomin series/line. For each, give the character/name, the release year if known (else null), ` +
    `the edition type (standard, seasonal, limited, anniversary, etc.), and a short note. Be as complete and accurate as you can. Return JSON only.`;
  const schema = {
    type: "OBJECT",
    properties: {
      mugs: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: { character: { type: "STRING" }, year: { type: "INTEGER", nullable: true }, edition: { type: "STRING" }, notes: { type: "STRING" } },
          required: ["character"],
        },
      },
    },
    required: ["mugs"],
  };
  const { text } = await generate({ schema, parts: [{ text: prompt }] });
  const obj = parseJson<{ mugs?: CatalogEntry[] }>(text);
  return obj?.mugs || [];
}

/** Broad, on-demand web search across retailers/marketplaces (returns prose + linked sources). */
export async function groundedDealSearch(q: string): Promise<{ text: string; sources: { title: string; uri: string }[] }> {
  const prompt =
    `Search the web — popular retailers and second-hand marketplaces (eBay, Etsy, Tradera, Vinted, Finnish Design Shop, Arabia) — for this item currently for sale:\n"${q}".\n` +
    `${region() ? `Prioritise availability and prices for the ${region()} market. ` : ""}` +
    `List any live listings with seller/retailer, price, and a direct link. If nothing concrete, say so. Keep it concise.`;
  const { text, grounding } = await generate({ useSearch: true, parts: [{ text: prompt }] });
  return { text, sources: grounding };
}

/**
 * Search a single site (marketplace or retailer) for live listings of a mug,
 * via Google-Search grounding restricted to that domain. Returns normalized
 * Listing objects (the notifier + UI consume these directly).
 *
 * These sites have no public listing API, so this is the reliable serverless
 * path that avoids scraping. Coverage depends on what Google has indexed —
 * strong for Tradera/Blocket/Cervera/Arabia, weak for login-gated Facebook
 * Marketplace.
 */
export async function searchSiteListings(query: string, domain: string, sourceName: string): Promise<Listing[]> {
  const prompt =
    `Search ${domain} for current, live for-sale listings of this exact item: "${query}". ` +
    `Only include real product/listing pages hosted on ${domain}. ` +
    `Respond with ONLY a JSON array (no prose) of up to 6 objects with this shape: ` +
    `{"title": string, "price": number|null, "currency": string|null, "url": string}. ` +
    `"url" must be a direct link on ${domain}. If there are none, respond with [].`;
  const { text, grounding } = await generate({ useSearch: true, parts: [{ text: prompt }] });

  let listings: Listing[] = [];
  const parsed = parseJson<Array<{ title?: string; price?: number | null; currency?: string | null; url?: string }>>(text);
  if (Array.isArray(parsed)) {
    listings = parsed
      .filter((x) => x && typeof x.url === "string")
      .map((x) => ({
        source: sourceName,
        title: String(x.title || sourceName),
        price: typeof x.price === "number" ? x.price : null,
        currency: x.currency || null,
        url: String(x.url),
        imageUrl: null,
        condition: null,
      }));
  }
  // Fallback: derive listings straight from grounding metadata.
  if (!listings.length && grounding.length) {
    listings = grounding.slice(0, 6).map((g) => ({
      source: sourceName,
      title: g.title || sourceName,
      price: null,
      currency: null,
      url: g.uri,
      imageUrl: null,
      condition: null,
    }));
  }
  return listings.filter((l) => /^https?:\/\//.test(l.url));
}
