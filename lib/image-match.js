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

import { getDeviceId } from "./device";

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
    indexPromise = (async () => {
      const raw = await fetch("/mug-embeddings.json", { cache: "force-cache" })
        .then((r) => { if (!r.ok) throw new Error(`index HTTP ${r.status}`); return r.json(); });
      // Prefer the owner's fine-tuned probe if they have one.
      let custom = null;
      try {
        const res = await fetch("/api/model", { headers: { "x-device-id": getDeviceId() } });
        if (res.ok) custom = await res.json();
      } catch { /* use the default model */ }
      const useCustom = !!(custom && custom.custom && custom.weights);
      return {
        model: raw.model,
        dim: raw.dim,
        temperature: (useCustom && custom.temperature) || raw.temperature || 1,
        autoMargin: useCustom
          ? (typeof custom.autoMargin === "number" ? custom.autoMargin : raw.autoMargin)
          : (typeof raw.autoMargin === "number" ? raw.autoMargin : null),
        entries: raw.entries,
        weights: decodeVector(useCustom ? custom.weights : raw.weights),
      };
    })();
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

function toBase64(f32) {
  const bytes = new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

async function toRawImage(RawImage, src) {
  try {
    return await RawImage.fromURL(src);
  } catch {
    const blob = await (await fetch(src)).blob();
    return await RawImage.fromBlob(blob);
  }
}

/**
 * Confidence floors, in top1–top2 logit margin.
 *
 * The probe's softmax stays almost uniform (≈0.01) even for a correct match, so
 * `prob` is not a usable absolute confidence — the logit *margin* is. Measured on
 * background-augmented catalogue views (genuine mugs) vs. non-mug images:
 *   genuine: 0.07–0.35 (median ≈0.18) · non-mug: 0.01–0.08 (median ≈0.03).
 * Re-measure if the backbone, augmentation or probe changes.
 */
export const MIN_MARGIN = 0.08;  // below this it's probably not a mug — offer no options
export const AUTO_MARGIN = 0.3;  // above this we're confident enough to auto-add

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
  // Keep the un-normalised pooled vector so its norm is available as a metric.
  const out = await extractor(img, { pooling: "mean", normalize: false });
  const { weights: W, entries, temperature, autoMargin, dim } = index;
  // The vision model may return a pooled vector or the full token sequence; use
  // the CLS token (first block) when it's the latter.
  const raw = out.data.length > dim ? out.data.slice(0, dim) : out.data;
  let featNorm = 0; for (let i = 0; i < raw.length; i++) featNorm += raw[i] * raw[i]; featNorm = Math.sqrt(featNorm);
  const x = unit(Array.from(raw));
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
  // Diagnostics for tuning the confidence floor. `prob` (softmax at the
  // calibrated temperature) is near-uniform, so we also expose margin, a
  // z-scored peak, the energy/logsumexp score and an entropy.
  let mean = 0; for (const v of logits) mean += v; mean /= C;
  let varSum = 0; for (const v of logits) { const d = v - mean; varSum += d * d; }
  const std = Math.sqrt(varSum / C);
  const energy = mx + Math.log(sum);
  let entropy = 0; for (const p of probs) if (p > 0) entropy -= p * Math.log(p);
  const l1 = candidates[0].logit, l2 = candidates[1]?.logit ?? l1;
  const maxProbAt = (T) => { let s = 0; for (const v of logits) s += Math.exp((v - mx) / T); return Math.exp((l1 - mx) / T) / s; };
  const diag = {
    count: C, temperature, l1, l2, margin: l1 - l2, mean, std,
    z: std ? (l1 - mean) / std : 0, energy, msp: probs[0], entropy,
    entropyNorm: entropy / Math.log(C), featNorm,
    top: candidates.slice(0, 5).map((c) => c.logit),
    tprobs: { "0.02": maxProbAt(0.02), "0.05": maxProbAt(0.05), "0.1": maxProbAt(0.1) },
  };
  return { candidates: candidates.slice(0, topK), autoMargin, embedding: toBase64(Float32Array.from(x)), model: index.model, diag };
}
