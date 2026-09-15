/* On-device mug matching — free, private, no API calls.
 *
 * Loads a small CLIP vision model from a CDN, runs it on the photo, and applies
 * a linear probe trained on background-augmented catalogue views
 * (public/mug-embeddings.json). The model is downloaded once and cached by the
 * browser. Everything here runs in the browser; nothing is uploaded.
 */

const TRANSFORMERS_CDN = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0";
// Hide the dynamic import from the bundler so it stays a runtime CDN import.
const importModule = new Function("u", "return import(u)");

let tfPromise = null;
let extractorPromise = null;
let indexPromise = null;
let ready = false;
let loadProgress = 0;

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
      .then((raw) => ({
        model: raw.model,
        dim: raw.dim,
        temperature: raw.temperature || 1,
        autoMargin: typeof raw.autoMargin === "number" ? raw.autoMargin : null,
        entries: raw.entries,
        weights: decodeVector(raw.weights),
      }));
  }
  return indexPromise;
}

async function getExtractor() {
  if (!extractorPromise) {
    extractorPromise = (async () => {
      const index = await loadIndex();
      const { pipeline, env } = await getTF();
      if (env) { env.allowLocalModels = false; env.useBrowserCache = true; }
      const ex = await pipeline("image-feature-extraction", index.model, {
        dtype: "q8", // must match how the probe was trained
        progress_callback: (p) => { if (p && typeof p.progress === "number") loadProgress = p.progress; },
      });
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

/** Download progress of the model files, 0–100 (for the first-time load). */
export function getProgress() {
  return loadProgress;
}

function unit(v) { let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1; return v.map((x) => x / n); }

async function toRawImage(RawImage, src) {
  try {
    return await RawImage.fromURL(src);
  } catch {
    const blob = await (await fetch(src)).blob();
    return await RawImage.fromBlob(blob);
  }
}

/**
 * Match a photo against the catalogue. Runs the frozen CLIP encoder, applies the
 * trained linear probe, and returns `{ candidates, autoMargin }`. Each candidate
 * carries `logit` and `prob`; `autoMargin` is the minimum top1–top2 logit gap
 * that was calibrated for ~98% precision (null = never auto-accept). Throws if
 * the model can't load — callers should fall back to the server path.
 */
export async function matchMug(imageDataUrl, { topK = 5 } = {}) {
  const { RawImage } = await getTF();
  const [extractor, index] = await Promise.all([getExtractor(), loadIndex()]);
  const img = await toRawImage(RawImage, imageDataUrl);
  const out = await extractor(img, { pooling: "mean", normalize: true });
  // DINOv2 returns the token sequence; use the CLS token (first block).
  const raw = out.dims && out.dims.length === 3 ? out.data.slice(0, out.dims[2]) : out.data;
  const x = unit(Array.from(raw));
  const { weights: W, entries, temperature, autoMargin } = index;
  const C = entries.length, D = x.length;
  const logits = new Float64Array(C);
  for (let a = 0; a < D; a++) { const xa = x[a]; if (!xa) continue; const off = a * C; for (let c = 0; c < C; c++) logits[c] += xa * W[off + c]; }
  const boff = D * C; for (let c = 0; c < C; c++) logits[c] += W[boff + c];
  let mx = -Infinity; for (const v of logits) if (v > mx) mx = v;
  let sum = 0; const probs = new Float64Array(C);
  for (let c = 0; c < C; c++) { probs[c] = Math.exp((logits[c] - mx) / temperature); sum += probs[c]; }
  for (let c = 0; c < C; c++) probs[c] /= sum;
  const candidates = entries.map((e, i) => ({ ...e, logit: logits[i], prob: probs[i] }));
  candidates.sort((a, b) => b.logit - a.logit);
  return { candidates: candidates.slice(0, topK), autoMargin };
}
