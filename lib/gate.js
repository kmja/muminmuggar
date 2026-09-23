/* Mug / not-mug gate.
 *
 * The catalogue probe was trained with only positives (augmented catalogue
 * views), so it has no notion of "this isn't a mug at all" — every photo gets a
 * confident-looking top-4. This trains a tiny logistic regression on the shared
 * DINOv2 features from real captures (mug vs. not-mug), giving a calibrated
 * P(mug) to gate the picker.
 *
 * Two sources:
 *   - a GLOBAL head, baked to public/mug-gate.json from exported captures and
 *     served to every user (built by scripts/train-mug-gate.mjs);
 *   - a LOCAL head trained in /train on this device, which overrides the global
 *     one so a session takes effect immediately.
 */

const GLOBAL_URL = "/mug-gate.json";
const LS_SAMPLES = "muminmuggar-gate-samples-v1";
const LS_HEAD = "muminmuggar-gate-head-v1";
// Below this P(mug) a photo is treated as "not a mug".
export const GATE_THRESHOLD = 0.5;

let globalHead = null;
let globalTried = false;

function b64ToVec(s) {
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}

function vecToB64(f32) {
  const bytes = new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function parseHead(raw) {
  if (!raw || !raw.weights) return null;
  return {
    w: typeof raw.weights === "string" ? b64ToVec(raw.weights) : Float32Array.from(raw.weights),
    b: raw.bias || 0,
    threshold: typeof raw.threshold === "number" ? raw.threshold : GATE_THRESHOLD,
    dim: raw.dim,
    meta: { pos: raw.pos, neg: raw.neg, accuracy: raw.accuracy, source: raw.source || "global" },
  };
}

/** Fetch the baked global gate once (no-op if it doesn't exist yet). */
export async function loadGlobalGate() {
  if (globalTried) return globalHead;
  globalTried = true;
  try {
    const res = await fetch(GLOBAL_URL, { cache: "force-cache" });
    if (res.ok) globalHead = parseHead(await res.json());
  } catch { /* no global gate yet */ }
  return globalHead;
}

function readLocalHead() {
  try { return parseHead(JSON.parse(localStorage.getItem(LS_HEAD) || "null")); } catch { return null; }
}

/** The head in use: a local one if trained here, otherwise the global one. */
export function getGate() {
  return readLocalHead() || globalHead;
}

/** P(mug) for a feature vector, or null when no gate is available. */
export function gateProb(vec) {
  const g = getGate();
  if (!g || !vec) return null;
  let z = g.b;
  const n = Math.min(vec.length, g.w.length);
  for (let i = 0; i < n; i++) z += g.w[i] * vec[i];
  return 1 / (1 + Math.exp(-z));
}

export function gateThreshold() {
  const g = getGate();
  return g ? g.threshold : GATE_THRESHOLD;
}

/* ------------------------------ samples ------------------------------- */

export function getSamples() {
  try { return JSON.parse(localStorage.getItem(LS_SAMPLES) || "[]"); } catch { return []; }
}

export function addSample(vec, y) {
  const s = getSamples();
  s.push({ y: y ? 1 : 0, v: vecToB64(vec) });
  localStorage.setItem(LS_SAMPLES, JSON.stringify(s));
  return s.length;
}

export function clearSamples() {
  localStorage.removeItem(LS_SAMPLES);
}

export function sampleCounts() {
  const s = getSamples();
  let pos = 0, neg = 0;
  for (const x of s) (x.y ? pos++ : neg++);
  return { pos, neg, total: s.length };
}

/* ------------------------------ training ------------------------------ */

function sigmoid(z) { return 1 / (1 + Math.exp(-z)); }

/** Logistic regression with L2, a couple of hundred full-batch steps. */
export function trainHead(samples, { epochs = 600, lr = 0.4, l2 = 3e-3, seed = 1 } = {}) {
  const rows = samples.map((s) => ({ y: s.y, x: typeof s.v === "string" ? b64ToVec(s.v) : Float32Array.from(s.v) }));
  if (rows.length < 8) return { error: "too-few" };
  const pos = rows.filter((r) => r.y).length, neg = rows.length - pos;
  if (!pos || !neg) return { error: "one-class" };
  // Deterministic shuffle, then an 80/20 split for a held-out accuracy estimate.
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = rows.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [rows[i], rows[j]] = [rows[j], rows[i]]; }
  const cut = Math.max(1, Math.floor(rows.length * 0.2));
  const val = rows.slice(0, cut), train = rows.slice(cut);
  const d = train[0].x.length;
  const w = new Float32Array(d); let b = 0;
  for (let e = 0; e < epochs; e++) {
    const gw = new Float32Array(d); let gb = 0;
    for (const r of train) {
      let z = b; for (let j = 0; j < d; j++) z += w[j] * r.x[j];
      const err = sigmoid(z) - r.y;
      for (let j = 0; j < d; j++) gw[j] += err * r.x[j];
      gb += err;
    }
    const n = train.length;
    for (let j = 0; j < d; j++) w[j] -= lr * (gw[j] / n + l2 * w[j]);
    b -= lr * (gb / n);
  }
  const acc = (list) => list.length ? list.filter((r) => { let z = b; for (let j = 0; j < d; j++) z += w[j] * r.x[j]; return (z > 0 ? 1 : 0) === r.y; }).length / list.length : 0;
  return { w, b, dim: d, pos, neg, total: rows.length, trainAcc: acc(train), valAcc: acc(val), valN: val.length };
}

/** Train on the stored captures and make the result the local (active) head. */
export function trainLocal() {
  const samples = getSamples();
  const res = trainHead(samples);
  if (res.error) return res;
  const head = {
    dim: res.dim, weights: vecToB64(res.w), bias: res.b, threshold: GATE_THRESHOLD,
    pos: res.pos, neg: res.neg, accuracy: res.valAcc, source: "local", builtAt: new Date().toISOString(),
  };
  localStorage.setItem(LS_HEAD, JSON.stringify(head));
  return res;
}

export function clearLocalHead() {
  localStorage.removeItem(LS_HEAD);
}

/** JSONL of the captures (one {y,v} per line) for baking a global gate. */
export function exportSamples() {
  return getSamples().map((s) => JSON.stringify(s)).join("\n") + "\n";
}
