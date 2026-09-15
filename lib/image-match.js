/* On-device mug matching — free, private, no API calls.
 *
 * Loads a small CLIP vision model from a CDN and matches a photo against
 * precomputed, background-augmented catalogue prototypes (public/mug-embeddings.json).
 * The model is downloaded once and cached by the browser. Everything here runs
 * in the browser; nothing is uploaded.
 */

const TRANSFORMERS_CDN = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0";
// Hide the dynamic import from the bundler so it stays a runtime CDN import.
const importModule = new Function("u", "return import(u)");

let tfPromise = null;
let extractorPromise = null;
let indexPromise = null;
let ready = false;

function getTF() {
  if (!tfPromise) tfPromise = importModule(TRANSFORMERS_CDN);
  return tfPromise;
}

function decodeVector(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}

export function loadIndex() {
  if (!indexPromise) {
    indexPromise = fetch("/mug-embeddings.json", { cache: "force-cache" })
      .then((r) => { if (!r.ok) throw new Error(`index HTTP ${r.status}`); return r.json(); })
      .then((raw) => ({ model: raw.model, dim: raw.dim, entries: raw.entries, vectors: raw.vectors.map(decodeVector) }));
  }
  return indexPromise;
}

async function getExtractor() {
  if (!extractorPromise) {
    extractorPromise = (async () => {
      const index = await loadIndex();
      const { pipeline } = await getTF();
      const ex = await pipeline("image-feature-extraction", index.model, { dtype: "q8" });
      ready = true;
      return ex;
    })();
  }
  return extractorPromise;
}

/** Start downloading the model + index in the background. */
export function warmUp() {
  getExtractor().catch(() => {});
  loadIndex().catch(() => {});
}

/** True once the model has actually finished loading (so the UI can show progress). */
export function isReady() {
  return ready;
}

function unit(v) { let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1; return v.map((x) => x / n); }
function dot(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }

async function toRawImage(RawImage, src) {
  try {
    return await RawImage.fromURL(src);
  } catch {
    const blob = await (await fetch(src)).blob();
    return await RawImage.fromBlob(blob);
  }
}

/**
 * Match a photo against the catalogue. Returns the top-K entries with a cosine
 * score (higher is closer). Throws if the model can't be loaded — callers should
 * fall back to the server path.
 */
export async function matchMug(imageDataUrl, { topK = 5 } = {}) {
  const { RawImage } = await getTF();
  const [extractor, index] = await Promise.all([getExtractor(), loadIndex()]);
  const img = await toRawImage(RawImage, imageDataUrl);
  const out = await extractor(img, { pooling: "mean", normalize: true });
  const q = unit(Array.from(out.data));
  const scored = index.vectors.map((v, i) => ({ ...index.entries[i], score: dot(q, v) }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}
