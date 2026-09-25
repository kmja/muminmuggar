// Bake the global mug / not-mug gate from exported live captures.
//
// The /train page exports a JSONL of DINOv2 feature vectors with a mug/not-mug
// label (one {y, v} per line, v is base64 Float32). This fits a small logistic
// regression on them and writes public/mug-gate.json, which every client loads
// and uses to gate the photo picker.
//
// Run with:  npm run train:gate -- ~/Downloads/mug-gate-samples.jsonl [more.jsonl]
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const THRESHOLD = 0.5;
const EPOCHS = 800;
const LR = 0.4;
const L2 = 3e-3;

const files = process.argv.slice(2);
if (!files.length) {
  console.error("Usage: npm run train:gate -- <samples.jsonl> [more.jsonl ...]");
  process.exit(1);
}

function b64ToVec(s) {
  const buf = Buffer.from(s, "base64");
  const out = new Float32Array(buf.length / 4);
  for (let i = 0; i < out.length; i++) out[i] = buf.readFloatLE(i * 4);
  return out;
}
function vecToB64(f32) {
  const buf = Buffer.alloc(f32.length * 4);
  for (let i = 0; i < f32.length; i++) buf.writeFloatLE(f32[i], i * 4);
  return buf.toString("base64");
}
const sigmoid = (z) => 1 / (1 + Math.exp(-z));

// ---- load every exported file --------------------------------------------
const rows = [];
for (const f of files) {
  const text = await readFile(f, "utf8");
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    const o = JSON.parse(t);
    const x = typeof o.v === "string" ? b64ToVec(o.v) : Float32Array.from(o.v);
    rows.push({ y: o.y ? 1 : 0, x });
  }
}
const dim = rows[0]?.x.length || 0;
const bad = rows.filter((r) => r.x.length !== dim);
if (bad.length) { console.error(`${bad.length} rows have the wrong dimension`); process.exit(1); }
let pos = 0; for (const r of rows) if (r.y) pos++;
const neg = rows.length - pos;
console.log(`Loaded ${rows.length} samples (${pos} mugs, ${neg} not-mugs, dim ${dim})`);
if (pos < 8 || neg < 8) { console.error("Need at least 8 of each."); process.exit(1); }

// ---- logistic regression -------------------------------------------------
function fitLR(list) {
  const w = new Float32Array(dim);
  let b = 0;
  for (let e = 0; e < EPOCHS; e++) {
    const gw = new Float32Array(dim);
    let gb = 0;
    for (const r of list) {
      let z = b;
      for (let j = 0; j < dim; j++) z += w[j] * r.x[j];
      const err = sigmoid(z) - r.y;
      for (let j = 0; j < dim; j++) gw[j] += err * r.x[j];
      gb += err;
    }
    const n = list.length;
    for (let j = 0; j < dim; j++) w[j] -= LR * (gw[j] / n + L2 * w[j]);
    b -= LR * (gb / n);
  }
  return { w, b };
}
const scoreWith = (m, r) => { let z = m.b; for (let j = 0; j < dim; j++) z += m.w[j] * r.x[j]; return z; };

// ---- deterministic shuffle ----------------------------------------------
let s = 1234567 >>> 0;
const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
const shuf = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// ---- stratified K-fold CV for an honest accuracy estimate ---------------
// (a single 20% holdout is only ~8 samples, far too noisy to report)
const K = 5;
const folds = Array.from({ length: K }, () => []);
shuf(rows.filter((r) => r.y)).forEach((r, i) => folds[i % K].push(r));
shuf(rows.filter((r) => !r.y)).forEach((r, i) => folds[i % K].push(r));
let tp = 0, tn = 0, fp = 0, fn = 0, correct = 0;
for (let k = 0; k < K; k++) {
  const held = folds[k];
  const model = fitLR(folds.filter((_, i) => i !== k).flat());
  for (const r of held) {
    const pred = scoreWith(model, r) > 0 ? 1 : 0;
    if (pred === r.y) correct++;
    if (pred && r.y) tp++; else if (!pred && !r.y) tn++; else if (pred && !r.y) fp++; else fn++;
  }
}
const cvAcc = correct / rows.length;
console.log(`${K}-fold CV: acc ${(cvAcc * 100).toFixed(1)}%  (${correct}/${rows.length})  tp ${tp} tn ${tn} fp ${fp} fn ${fn}`);

// ---- final model: train on ALL samples (CV already gave the estimate) ----
const { w, b } = fitLR(rows);

// ---- write the global gate -----------------------------------------------
const payload = {
  model: "dinov2-small",
  dim,
  weights: vecToB64(w),
  bias: b,
  threshold: THRESHOLD,
  pos,
  neg,
  accuracy: +cvAcc.toFixed(4),
  cvFolds: K,
  source: "global",
  builtAt: new Date().toISOString(),
};
await writeFile(path.join(ROOT, "public/mug-gate.json"), JSON.stringify(payload));
const bytes = (await readFile(path.join(ROOT, "public/mug-gate.json"))).length;
console.log(`Wrote public/mug-gate.json — dim ${dim}, trained on all ${rows.length}, ${(bytes / 1024).toFixed(1)} KB, threshold ${THRESHOLD}`);
