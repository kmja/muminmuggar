import masterCatalog from "./master-catalog.json";
import { readCatalogImage } from "./catalog";

/**
 * DeepSeek V4.1 Flash recognition.
 *
 * Two designs, chosen at runtime by DEEPSEEK_MODE (default "vision"):
 *  - "vision" (design C): send the photo plus EVERY catalogue reference image and
 *    let the model match visually. Most accurate and most expensive; the model
 *    always sees every design.
 *  - "text" (design A): send the photo plus the catalogue as a numbered text list
 *    and take the catalogue `num` back. Cheaper; relies on the model's memory.
 *
 * Either way the model returns the catalogue `num` directly (no name → fuzzy-match
 * step), so our matcher's failure mode is gone. The catalogue (list or images) is a
 * stable prefix, ordered before the photo, so the provider can cache it.
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

/** The numbered catalogue shown to the model (design A). Cacheable prefix. */
const CATALOG_LIST = CATALOG.map((e) => {
  const bits = [e.nameEn];
  if (e.year) bits.push(`(${e.year})`);
  if (e.capacity) bits.push(e.capacity);
  return `${e.num}. ${bits.join(" ")}`;
}).join("\n");

const MATCH_SHAPE =
  'Respond with JSON only, exactly: {"mugs": [{"num": <integer>, "position": "<string>", "confidence": <number 0..1>, "reason": "<short English reason>"}]}';

const SYSTEM_TEXT =
  "You are an expert on Arabia Moomin mugs. Identify every Moomin mug visible in the photograph by selecting the exact catalogue entry for each.\n\n" +
  "Rules:\n" +
  "- For EACH distinct mug in the photo (left-to-right, top-to-bottom), choose exactly ONE catalogue entry whose design matches: artwork, characters, pose, colours, background and shape. Many entries share a character but differ in artwork — match the DESIGN, not just the character.\n" +
  "- Only choose from the numbered entries below; never invent an entry.\n" +
  "- Give each mug a short position (e.g. \"top shelf, 2nd from left\").\n" +
  "- If you cannot confidently match a mug, omit it. If the photo shows no Moomin mug, return an empty list.\n\n" +
  `Catalogue:\n${CATALOG_LIST}\n\n` +
  MATCH_SHAPE;

const USER_TEXT =
  "Identify every Moomin mug in this photo against the catalogue. Match each exact design. " + MATCH_SHAPE;

const SYSTEM_VISION =
  "You are an expert on Arabia Moomin mugs. You are given a numbered set of official catalogue reference photos, then a photograph of one or more mugs to identify.\n\n" +
  "Rules:\n" +
  "- For EACH mug in the photograph (left-to-right, top-to-bottom), choose the catalogue entry whose design exactly matches that mug: artwork, characters, pose, colours, background and shape. Many entries share a character but differ in artwork — match the DESIGN, not just the character.\n" +
  "- Only choose catalogue numbers that appear in the references; never invent one.\n" +
  "- Give each mug a short position (e.g. \"top shelf, 2nd from left\").\n" +
  "- Omit any mug you cannot confidently match. If none match, return an empty list.\n\n" +
  MATCH_SHAPE;

export interface DeepSeekMatch {
  /** Catalogue number (always a valid entry). */
  num: number;
  /** Where the mug is in the photo, e.g. "top shelf, 2nd from left" (may be empty). */
  position: string;
  confidence: number;
  reason: string;
  entry: MasterEntry;
}

export function deepseekConfigured(): boolean {
  return Boolean(process.env.DEEPSEEK_API_KEY);
}

/** "vision" (design C, default) or "text" (design A). */
export function deepseekMode(): "vision" | "text" {
  return (process.env.DEEPSEEK_MODE || "vision").trim().toLowerCase() === "text" ? "text" : "vision";
}

function model(): string {
  return (process.env.DEEPSEEK_MODEL || "deepseek-flash").trim();
}
function baseUrl(): string {
  return (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/+$/, "");
}

/** Abort the upstream call well before the serverless function's own limit. */
const REQUEST_TIMEOUT_MS = 50_000;

type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: string } };

type ChatMessage = { role: "system" | "user"; content: string | ContentPart[] };

function dataUrlParts(dataUrl: string): { mime: string; data: string } {
  const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl || "");
  if (m) return { mime: m[1], data: m[2] };
  return { mime: "image/jpeg", data: (dataUrl || "").split(",").pop() || "" };
}

function imagePart(dataUrl: string): ContentPart {
  const { mime, data } = dataUrlParts(dataUrl);
  return { type: "image_url", image_url: { url: `data:${mime};base64,${data}`, detail: "high" } };
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

async function callChatOnce(key: string, messages: ChatMessage[]): Promise<{ content: string; finishReason: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${baseUrl()}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      signal: controller.signal,
      body: JSON.stringify({
        model: model(),
        messages,
        response_format: { type: "json_object" },
        // Recognition is a lookup, not a reasoning task. Thinking is ON by default
        // at "high" effort, and its chain-of-thought (reasoning_content) counts
        // against max_tokens — which crowds the JSON out of `content` (→ parse
        // errors) and makes the call slow enough to time out. Turn it off.
        thinking: { type: "disabled" },
        temperature: 0,
        max_tokens: 1200,
      }),
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw new Error(`DeepSeek timed out after ${REQUEST_TIMEOUT_MS / 1000}s.`);
    throw e;
  } finally {
    clearTimeout(timer);
  }

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
  const choice = json?.choices?.[0];
  return { content: choice?.message?.content || "", finishReason: choice?.finish_reason || "" };
}

async function callChat(messages: ChatMessage[]): Promise<string> {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new Error("DEEPSEEK_API_KEY is not set on the server.");
  // JSON Output can occasionally come back empty; retry once (DeepSeek's advice).
  let last: { content: string; finishReason: string } = { content: "", finishReason: "" };
  for (let attempt = 0; attempt < 2; attempt++) {
    last = await callChatOnce(key, messages);
    if (last.content.trim()) return last.content;
  }
  throw new Error(`DeepSeek returned empty content (finish_reason=${last.finishReason || "?"}).`);
}

function parseMatches(content: string): DeepSeekMatch[] {
  const obj = parseJson<{ mugs?: Array<{ num?: number | string; position?: string; confidence?: number; reason?: string }> }>(content);
  if (!obj) throw new Error(`Could not parse DeepSeek's response: ${content.slice(0, 200) || "(empty)"}`);

  const out: DeepSeekMatch[] = [];
  const seen = new Set<number>();
  for (const m of obj.mugs || []) {
    const num = Number(m.num);
    const entry = Number.isInteger(num) ? BY_NUM.get(num) : undefined;
    if (!entry || seen.has(entry.num)) continue; // skip unknown / duplicate entries
    seen.add(entry.num);
    const confidence = Number.isFinite(Number(m.confidence)) ? Math.max(0, Math.min(1, Number(m.confidence))) : 0;
    out.push({ num: entry.num, position: String(m.position || ""), confidence, reason: String(m.reason || ""), entry });
  }
  return out;
}

/** Design A — catalogue as a numbered text list. */
export async function identifyMugsFromCatalog(photoDataUrl: string): Promise<DeepSeekMatch[]> {
  const content = await callChat([
    { role: "system", content: SYSTEM_TEXT },
    { role: "user", content: [{ type: "text", text: USER_TEXT }, imagePart(photoDataUrl)] },
  ]);
  return parseMatches(content);
}

// Design C — the catalogue's reference images, read from public/mugs and cached in
// memory for the life of the serverless instance (they never change per request).
let refCache: { entry: MasterEntry; dataUrl: string }[] | null = null;
async function loadRefs(): Promise<{ entry: MasterEntry; dataUrl: string }[]> {
  if (refCache) return refCache;
  const out: { entry: MasterEntry; dataUrl: string }[] = [];
  for (const e of CATALOG) {
    const dataUrl = await readCatalogImage(e.image || "");
    if (dataUrl) out.push({ entry: e, dataUrl });
  }
  refCache = out;
  return out;
}

/**
 * Design C — photo + every catalogue reference image. The references come first
 * (a large, stable, cacheable prefix) and the photo last.
 */
export async function identifyMugsFromCatalogImages(photoDataUrl: string): Promise<DeepSeekMatch[]> {
  const refs = await loadRefs();
  if (!refs.length) throw new Error("No catalogue reference images found (is public/mugs shipped with this route?)");

  const parts: ContentPart[] = [
    { type: "text", text: "Catalogue references — each label is immediately followed by that entry's official product photo:" },
  ];
  for (const r of refs) {
    parts.push({ type: "text", text: `#${r.entry.num} ${r.entry.nameEn}${r.entry.year ? ` (${r.entry.year})` : ""}` });
    parts.push(imagePart(r.dataUrl));
  }
  parts.push({ type: "text", text: "Now identify the mug(s) in the photograph below. Match each to a catalogue number above." });
  parts.push(imagePart(photoDataUrl));

  const content = await callChat([
    { role: "system", content: SYSTEM_VISION },
    { role: "user", content: parts },
  ]);
  return parseMatches(content);
}
