// Build the on-device matcher for every catalogue mug.
//
// A clean product shot looks nothing like a phone photo of a mug on a table, so
// a raw embedding is dominated by the background and retrieval fails. We embed
// many augmented views of each mug (composited onto random backgrounds, rotated,
// scaled, re-compressed), then train a ridge linear probe on those frozen
// features. The probe (a (D+1)x196 weight matrix) beats a prototype kNN by a
// clear margin and gives a calibrated confidence via softmax.
//
// Backbone: DINOv2-small (23 MB q8) — matches CLIP ViT-B/32 accuracy here at
// ~1/4 the download.
//
// Run with:  npm run build:embeddings
// Output:    public/mug-embeddings.json  (loaded lazily by lib/image-match.js)
import { pipeline, RawImage } from "@huggingface/transformers";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { augment } from "./lib/augment.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MODEL = "Xenova/dinov2-small";
const AUGS = 24;        // augmented views per mug
const CALIB = 6;        // held out for temperature calibration
const LAMBDA = 1;       // ridge regularisation

const master = JSON.parse(await readFile(path.join(ROOT, "lib/master-catalog.json"), "utf8"));

console.log(`Loading ${MODEL}…`);
const extractor = await pipeline("image-feature-extraction", MODEL, { dtype: "q8" });

const unit = (v) => { let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1; return v.map((x) => x / n); };
// DINOv2 returns the token sequence; use the CLS token (first block).
async function embed(buf) {
  const out = await extractor(await RawImage.fromBlob(new Blob([buf])), { pooling: "mean", normalize: true });
  const v = out.dims && out.dims.length === 3 ? Array.from(out.data.slice(0, out.dims[2])) : Array.from(out.data);
  return unit(v);
}

// ---- collect augmented features (train + calibration) --------------------
const train = [];
const calib = []; // { c, x }
let ci = 0;
for (const e of master) {
  const c = ci++;
  for (let i = 0; i < AUGS; i++) {
    const x = await embed(await augment(path.join(ROOT, "public", e.image)));
    if (i < CALIB) calib.push({ c, x }); else train.push({ c, x });
  }
  if (ci % 20 === 0) process.stdout.write(`\r  embedded ${ci}/${master.length} mugs   `);
}
process.stdout.write("\n");

// ---- train ridge probe ----------------------------------------------------
const D = train[0].x.length, C = master.length, Dp = D + 1;
const XtX = new Float64Array(Dp * Dp);
const XtY = new Float64Array(Dp * C);
for (const { c, x } of train) {
  const xa = new Float64Array(Dp); xa.set(x); xa[D] = 1;
  for (let a = 0; a < Dp; a++) { const va = xa[a]; for (let b = a; b < Dp; b++) XtX[a * Dp + b] += va * xa[b]; XtY[a * C + c] += va; }
}
for (let a = 0; a < Dp; a++) for (let b = 0; b < a; b++) XtX[a * Dp + b] = XtX[b * Dp + a];
// Keep the unregularised normal equations so the server can add real labels and
// re-solve (see app/api/finetune). Regularise a copy for this build.
const XtXbase = Float64Array.from(XtX);
for (let a = 0; a < Dp; a++) XtX[a * Dp + a] += LAMBDA;
const inv = invert(XtX, Dp);
const W = new Float64Array(Dp * C);
for (let a = 0; a < Dp; a++) for (let k = 0; k < Dp; k++) { const ia = inv[a * Dp + k]; if (!ia) continue; for (let c = 0; c < C; c++) W[a * C + c] += ia * XtY[k * C + c]; }

function logitsOf(x) {
  const s = new Float64Array(C);
  for (let a = 0; a < D; a++) { const va = x[a]; if (!va) continue; const off = a * C; for (let c = 0; c < C; c++) s[c] += va * W[off + c]; }
  const off = D * C; for (let c = 0; c < C; c++) s[c] += W[off + c];
  return s;
}
function softmax(s, T) {
  let mx = -Infinity; for (const v of s) if (v > mx) mx = v;
  let sum = 0; const p = new Float64Array(C);
  for (let c = 0; c < C; c++) { p[c] = Math.exp((s[c] - mx) / T); sum += p[c]; }
  for (let c = 0; c < C; c++) p[c] /= sum;
  return p;
}

// ---- calibrate temperature + an auto-accept margin ------------------------
let bestT = 1, bestNll = Infinity;
for (const T of [0.2, 0.3, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6]) {
  let nll = 0;
  for (const s of calib) { const p = softmax(logitsOf(s.x), T); nll -= Math.log(Math.max(1e-9, p[s.c])); }
  nll /= calib.length;
  if (nll < bestNll) { bestNll = nll; bestT = T; }
}
let top1 = 0, top5 = 0;
const rows = calib.map((s) => {
  const ranked = Array.from(logitsOf(s.x), (v, c) => ({ c, v })).sort((a, b) => b.v - a.v);
  if (ranked[0].c === s.c) top1++;
  if (ranked.slice(0, 5).some((r) => r.c === s.c)) top5++;
  return { correct: ranked[0].c === s.c, margin: ranked[0].v - ranked[1].v };
});
// Smallest margin whose accepted set keeps >=98% precision (null = never auto-accept).
const uniq = [...new Set(rows.map((r) => r.margin))].sort((a, b) => b - a);
let autoMargin = null;
for (const m of uniq) {
  const acc = rows.filter((r) => r.margin >= m);
  if (acc.filter((r) => r.correct).length / acc.length >= 0.98) autoMargin = m; else break;
}
const acc = autoMargin == null ? [] : rows.filter((r) => r.margin >= autoMargin);
const prec = acc.length ? acc.filter((r) => r.correct).length / acc.length : 0;
console.log(`Calibration: T=${bestT} NLL=${bestNll.toFixed(3)}  top-1 ${top1}/${calib.length}  top-5 ${top5}/${calib.length}`);
console.log(`Auto-accept margin ${autoMargin == null ? "n/a" : autoMargin.toFixed(3)} → covers ${acc.length}/${calib.length} at ${(prec * 100).toFixed(0)}% precision`);

const b64 = (arr) => Buffer.from(new Float32Array(arr).buffer).toString("base64");
const entries = master.map((e) => ({ num: e.num, nameEn: e.nameEn, year: e.year, image: e.image }));
const payload = { model: MODEL, dim: D, count: C, temperature: bestT, autoMargin, entries, weights: b64(W) };
await writeFile(path.join(ROOT, "public/mug-embeddings.json"), JSON.stringify(payload));
const bytes = (await readFile(path.join(ROOT, "public/mug-embeddings.json"))).length;
console.log(`Wrote public/mug-embeddings.json — ${C} classes, dim ${D}, ${(bytes / 1024).toFixed(0)} KB.`);

// Server-only prior for on-site fine-tuning (added to real labels, then re-solved).
const base = { dim: D, count: C, lambda: LAMBDA, temperature: bestT, autoMargin, entries, weights: b64(W), xtx: b64(XtXbase), xty: b64(XtY) };
await writeFile(path.join(ROOT, "lib/probe-base.json"), JSON.stringify(base));
const bbytes = (await readFile(path.join(ROOT, "lib/probe-base.json"))).length;
console.log(`Wrote lib/probe-base.json — ${(bbytes / 1024).toFixed(0)} KB.`);

function invert(A, n) {
  const M = Float64Array.from(A);
  const I = new Float64Array(n * n);
  for (let i = 0; i < n; i++) I[i * n + i] = 1;
  for (let col = 0; col < n; col++) {
    let piv = col; for (let r = col + 1; r < n; r++) if (Math.abs(M[r * n + col]) > Math.abs(M[piv * n + col])) piv = r;
    if (piv !== col) for (let k = 0; k < n; k++) { let t = M[col * n + k]; M[col * n + k] = M[piv * n + k]; M[piv * n + k] = t; t = I[col * n + k]; I[col * n + k] = I[piv * n + k]; I[piv * n + k] = t; }
    const d = M[col * n + col] || 1e-9;
    for (let k = 0; k < n; k++) { M[col * n + k] /= d; I[col * n + k] /= d; }
    for (let r = 0; r < n; r++) { if (r === col) continue; const f = M[r * n + col]; if (!f) continue; for (let k = 0; k < n; k++) { M[r * n + k] -= f * M[col * n + k]; I[r * n + k] -= f * I[col * n + k]; } }
  }
  return I;
}
