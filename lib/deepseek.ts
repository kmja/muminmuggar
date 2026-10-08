import masterCatalog from "./master-catalog.json";

/**
 * DeepSeek V4.1 Flash recognition (design "A").
 *
 * Instead of having the model name a mug and then fuzzy-matching that name to our
 * catalogue, we hand it the WHOLE catalogue as a numbered list and let it return
 * the catalogue `num` directly. This removes our fuzzy matcher (and its failure
 * mode) from the loop entirely: the model always considers every entry.
 *
 * The catalogue list lives in the system message so it is a stable prefix the
 * provider can cache (context caching bills repeat input at a fraction of the
 * cache-miss rate).
 */

type MasterEntry = {
  num: number;
  nameEn: string;
  nameSv?: string;
  year: number | null;
  years: string;
  capacity: string;
  estLow: number | null;
  estHigh: number | null;
  estCur: string;
  image: string | null;
  norm: string;
};

const CATALOG = masterCatalog as MasterEntry[];
const BY_NUM = new Map<number, MasterEntry>(CATALOG.map((e) => [e.num, e]));

/** The numbered catalogue shown to the model. Stable → cacheable prefix. */
const CATALOG_LIST = CATALOG.map((e) => {
  const bits = [e.nameEn];
  if (e.year) bits.push(`(${e.year})`);
  if (e.capacity) bits.push(e.capacity);
  return `${e.num}. ${bits.join(" ")}`;
}).join("\n");

const SYSTEM =
  "You are an expert on Arabia Moomin mugs. Identify the photographed mug by selecting the exact entry from our catalogue.\n\n" +
  "Rules:\n" +
  "- Choose exactly ONE catalogue entry whose design matches the photo: artwork, characters, pose, colours, background and shape. Many entries share a character but differ in artwork — match the DESIGN, not just the character.\n" +
  "- Only choose from the numbered entries below; never invent an entry.\n" +
  "- If the item is not a Moomin mug, or you cannot confidently match any entry, use 0.\n\n" +
  `Catalogue:\n${CATALOG_LIST}\n\n` +
  'Respond with JSON only, exactly: {"num": <integer>, "confidence": <number 0..1>, "reason": "<short English reason>"}';

const USER_TEXT =
  "Identify this Moomin mug against the catalogue. Match the exact design. " +
  "Return the catalogue number, or 0 if it is not a Moomin mug or none match. " +
  'Respond with JSON only: {"num": <integer>, "confidence": <number 0..1>, "reason": "<short reason>"}';

export interface DeepSeekMatch {
  /** Catalogue number, or 0 when the model found no match. */
  num: number;
  confidence: number;
  reason: string;
  /** The resolved catalogue entry, or null when `num` is 0 / unknown. */
  entry: MasterEntry | null;
}

export function deepseekConfigured(): boolean {
  return Boolean(process.env.DEEPSEEK_API_KEY);
}

function model(): string {
  return (process.env.DEEPSEEK_MODEL || "deepseek-flash").trim();
}
function baseUrl(): string {
  return (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/+$/, "");
}

function dataUrlParts(dataUrl: string): { mime: string; data: string } {
  const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl || "");
  if (m) return { mime: m[1], data: m[2] };
  return { mime: "image/jpeg", data: (dataUrl || "").split(",").pop() || "" };
}

function parseJson<T>(text: string): T | null {
  let t = (text || "").trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start >= 0 && end > start) t = t.slice(start, end + 1);
  try {
    return JSON.parse(t) as T;
  } catch {
    return null;
  }
}

/**
 * Ask DeepSeek V4.1 Flash to pick the catalogue entry directly. Throws when the
 * API key is missing or the request fails; returns `num: 0` when nothing matched.
 */
export async function identifyMugFromCatalog(photoDataUrl: string): Promise<DeepSeekMatch> {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new Error("DEEPSEEK_API_KEY is not set on the server.");

  const { mime, data } = dataUrlParts(photoDataUrl);
  const res = await fetch(`${baseUrl()}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: model(),
      messages: [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: [
            { type: "text", text: USER_TEXT },
            { type: "image_url", image_url: { url: `data:${mime};base64,${data}`, detail: "high" } },
          ],
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0,
      max_tokens: 1200,
    }),
  });

  if (!res.ok) {
    let msg = `DeepSeek ${res.status}`;
    try {
      const j = await res.json();
      msg = j?.error?.message || msg;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }

  const json = await res.json();
  const content: string = json?.choices?.[0]?.message?.content || "";
  const obj = parseJson<{ num?: number | string; confidence?: number; reason?: string }>(content);
  if (!obj) throw new Error("Could not parse DeepSeek's response.");

  const rawNum = Number(obj.num);
  const entry = Number.isInteger(rawNum) && rawNum > 0 ? BY_NUM.get(rawNum) || null : null;
  const confidence = Number.isFinite(Number(obj.confidence)) ? Math.max(0, Math.min(1, Number(obj.confidence))) : 0;
  return { num: entry ? entry.num : 0, confidence, reason: String(obj.reason || ""), entry };
}
