// Evaluate the current matcher on your real labelled photos (labels.jsonl), and
// optionally fine-tune the probe with them.
//
//   npm run eval:labels                 # real-photo top-1/top-5 + confusions
//   npm run eval:labels -- --train      # also cross-validate a fine-tuned probe
//   npm run eval:labels -- --train --write   # write a new mug-embeddings.json
//
// Real samples are up-weighted (--weight=N, default 10) so a handful of real
// photos can move the probe trained mostly on synthetic augmentation.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ROOT, createMatcher } from "./lib/model.mjs";
import { augment } from "./lib/augment.mjs";

const args = process.argv.slice(2);
const DO_TRAIN = args.includes("--train");
const DO_WRITE = args.includes("--write");
const REAL_WEIGHT = Number((args.find((a) => a.startsWith("--weight=")) || "").split("=")[1]) || 10;
const SYN_AUGS = 16;
const LAMBDA = 1;

const index = JSON.parse(await readFile(path.join(ROOT, "public/mug-embeddings.json"), "utf8"));
const D = index.dim, C = index.count, Dp = D + 1;
const clsOf = new Map(index.entries.map((e, i) => [e.num, i]));
const unit = (v) => { let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1; return v.map((x) => x / n); };
function decode(b64) { const b = Buffer.from(b64, "base64"); return unit(Array.from(new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4))); }
function currentW() { const b = Buffer.from(index.weights, "base64"); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4); }

const rows = [];
try {
  for (const line of (await readFile(path.join(ROOT, "labels.jsonl"), "utf8")).split("\n")) {
    if (!line.trim()) continue;
    const j = JSON.parse(line);
    if (j.chosenNum != null && j.embedding && clsOf.has(j.chosenNum)) rows.push({ file: j.file, x: decode(j.embedding), c: clsOf.get(j.chosenNum) });
  }
} catch { /* no labels yet */ }
if (!rows.length) { console.log("No labels.jsonl yet — run `npm run label -- <folder>` first."); process.exit(0); }

function logits(W, x) {
  const s = new Float64Array(C);
  for (let a = 0; a < D; a++) { const va = x[a]; if (!va) continue; const off = a * C; for (let c = 0; c < C; c++) s[c] += va * W[off + c]; }
  const o = D * C; for (let c = 0; c < C; c++) s[c] += W[o + c];
  return s;
}
function evaluate(W, set) {
  let t1 = 0, t5 = 0; const conf = new Map(), margins = [];
  for (const r of set) {
    const ranked = Array.from(logits(W, r.x), (v, c) => ({ c, v })).sort((a, b) => b.v - a.v);
    const ok = ranked[0].c === r.c;
    if (ok) t1++;
    if (ranked.slice(0, 5).some((z) => z.c === r.c)) t5++;
    else { const k = `${index.entries[r.c].nameEn} → ${index.entries[ranked[0].c].nameEn}`; conf.set(k, (conf.get(k) || 0) + 1); }
    margins.push({ ok, m: ranked[0].v - ranked[1].v });
  }
  return { t1, t5, conf, margins };
}
const pct = (a, b) => `${a}/${b} (${((a / b) * 100).toFixed(1)}%)`;

const base = evaluate(currentW(), rows);
console.log(`\nReal labelled photos: ${rows.length}`);
console.log(`Current model — top-1 ${pct(base.t1, rows.length)}  top-5 ${pct(base.t5, rows.length)}`);
if (index.autoMargin != null) {
  const acc = base.margins.filter((m) => m.m >= index.autoMargin);
  console.log(`Auto-accept (margin ≥ ${index.autoMargin.toFixed(3)}): covers ${acc.length}/${rows.length}${acc.length ? ` at ${((acc.filter((m) => m.ok).length / acc.length) * 100).toFixed(0)}% precision` : ""}`);
}
const mistakes = [...base.conf.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
if (mistakes.length) { console.log("Most common mistakes:"); for (const [k, n] of mistakes) console.log(`  ${n}×  ${k}`); }

if (!DO_TRAIN) { console.log("\n(Pass --train to cross-validate a fine-tuned probe.)"); process.exit(0); }

// ---- generate synthetic training features (once) --------------------------
const { embed } = await createMatcher();
const master = JSON.parse(await readFile(path.join(ROOT, "lib/master-catalog.json"), "utf8"));
console.log(`\nGenerating synthetic features (${SYN_AUGS}×${master.length})…`);
const XtXs = new Float64Array(Dp * Dp), XtYs = new Float64Array(Dp * C);
function accum(XtX, XtY, x, c, w) {
  const xa = new Float64Array(Dp); xa.set(x); xa[D] = 1;
  for (let a = 0; a < Dp; a++) { const va = w * xa[a]; for (let b = a; b < Dp; b++) XtX[a * Dp + b] += va * xa[b]; XtY[a * C + c] += va; }
}
for (let ci = 0; ci < master.length; ci++) {
  const p = path.join(ROOT, "public", master[ci].image);
  for (let i = 0; i < SYN_AUGS; i++) accum(XtXs, XtYs, await embed(await augment(p)), ci, 1);
  if (ci % 40 === 0) process.stdout.write(`\r  ${ci}/${master.length}   `);
}
process.stdout.write("\n");

function solve(XtX, XtY) {
  const A = Float64Array.from(XtX);
  for (let a = 0; a < Dp; a++) for (let b = 0; b < a; b++) A[a * Dp + b] = A[b * Dp + a];
  for (let a = 0; a < Dp; a++) A[a * Dp + a] += LAMBDA;
  const inv = invert(A, Dp);
  const W = new Float64Array(Dp * C);
  for (let a = 0; a < Dp; a++) for (let k = 0; k < Dp; k++) { const ia = inv[a * Dp + k]; if (!ia) continue; for (let c = 0; c < C; c++) W[a * C + c] += ia * XtY[k * C + c]; }
  return W;
}

// ---- cross-validate the fine-tune on the real labels ----------------------
const k = rows.length <= 25 ? rows.length : 5;
const shuffled = [...rows].sort(() => Math.random() - 0.5);
const folds = Array.from({ length: k }, () => []);
shuffled.forEach((r, i) => folds[i % k].push(r));
let ct1 = 0, ct5 = 0;
for (let f = 0; f < k; f++) {
  const XtX = Float64Array.from(XtXs), XtY = Float64Array.from(XtYs);
  for (let g = 0; g < k; g++) if (g !== f) for (const r of folds[g]) accum(XtX, XtY, r.x, r.c, REAL_WEIGHT);
  const W = solve(XtX, XtY);
  const ev = evaluate(W, folds[f]);
  ct1 += ev.t1; ct5 += ev.t5;
}
console.log(`Fine-tuned (weight ${REAL_WEIGHT}, ${k}-fold CV) — top-1 ${pct(ct1, rows.length)}  top-5 ${pct(ct5, rows.length)}`);

if (DO_WRITE) {
  const XtX = Float64Array.from(XtXs), XtY = Float64Array.from(XtYs);
  for (const r of rows) accum(XtX, XtY, r.x, r.c, REAL_WEIGHT);
  const W = solve(XtX, XtY);
  // Re-calibrate the auto-accept margin on the real labels.
  const ev = evaluate(W, rows);
  const uniq = [...new Set(ev.margins.map((m) => m.m))].sort((a, b) => b - a);
  let autoMargin = null;
  for (const m of uniq) { const acc = ev.margins.filter((x) => x.m >= m); if (acc.filter((x) => x.ok).length / acc.length >= 0.98) autoMargin = m; else break; }
  const payload = { ...index, autoMargin, weights: Buffer.from(new Float32Array(W).buffer).toString("base64") };
  await writeFile(path.join(ROOT, "public/mug-embeddings.json"), JSON.stringify(payload));
  console.log(`Wrote public/mug-embeddings.json (autoMargin ${autoMargin == null ? "n/a" : autoMargin.toFixed(3)}).`);
}

function invert(A, n) {
  const M = Float64Array.from(A), I = new Float64Array(n * n);
  for (let i = 0; i < n; i++) I[i * n + i] = 1;
  for (let col = 0; col < n; col++) {
    let piv = col; for (let r = col + 1; r < n; r++) if (Math.abs(M[r * n + col]) > Math.abs(M[piv * n + col])) piv = r;
    if (piv !== col) for (let kk = 0; kk < n; kk++) { let t = M[col * n + kk]; M[col * n + kk] = M[piv * n + kk]; M[piv * n + kk] = t; t = I[col * n + kk]; I[col * n + kk] = I[piv * n + kk]; I[piv * n + kk] = t; }
    const d = M[col * n + col] || 1e-9;
    for (let kk = 0; kk < n; kk++) { M[col * n + kk] /= d; I[col * n + kk] /= d; }
    for (let r = 0; r < n; r++) { if (r === col) continue; const fac = M[r * n + col]; if (!fac) continue; for (let kk = 0; kk < n; kk++) { M[r * n + kk] -= fac * M[col * n + kk]; I[r * n + kk] -= fac * I[col * n + kk]; } }
  }
  return I;
}
