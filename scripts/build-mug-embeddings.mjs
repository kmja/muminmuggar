// Build background-invariant CLIP prototypes for every catalogue mug.
//
// A clean product shot looks nothing like a phone photo of a mug on a table, so
// a raw CLIP embedding is dominated by the background and retrieval fails. We
// therefore embed many augmented views of each mug (composited onto random
// backgrounds, rotated, scaled, re-compressed) and average them into one
// prototype. Matching a real photo against these prototypes is free and runs
// entirely on-device.
//
// Run with:  npm run build:embeddings
// Output:    public/mug-embeddings.json  (loaded lazily by lib/image-match.js)
import { pipeline, RawImage } from "@huggingface/transformers";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import sharp from "sharp";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MODEL = "Xenova/clip-vit-base-patch32";
const AUGS = 16;

const master = JSON.parse(await readFile(path.join(ROOT, "lib/master-catalog.json"), "utf8"));

console.log(`Loading ${MODEL}…`);
const extractor = await pipeline("image-feature-extraction", MODEL, { dtype: "q8" });

const unit = (v) => { let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1; return v.map((x) => x / n); };
async function embed(buf) {
  const out = await extractor(await RawImage.fromBlob(new Blob([buf])), { pooling: "mean", normalize: true });
  return unit(Array.from(out.data));
}

// Realistic-ish backdrops: a two-stop gradient plus a touch of noise, so the
// model can't key on a single flat colour.
const COLS = ["#7d8a6a", "#8a7a6a", "#6a7d8a", "#8a6a7d", "#a8b0a0", "#5a4a3a", "#3a4a5a", "#c0b8a8", "#2a2a2a", "#e0d8c8", "#b0a890", "#4a5a4a"];
const rnd = (a, b) => a + Math.random() * (b - a);
function scene() {
  const c1 = COLS[Math.floor(Math.random() * COLS.length)];
  const c2 = COLS[Math.floor(Math.random() * COLS.length)];
  return `<svg width="800" height="800" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><rect width="800" height="800" fill="url(#g)"/></svg>`;
}
async function augment(imagePath) {
  const scale = rnd(0.6, 1.25);
  const angle = rnd(-15, 15);
  const q = Math.round(rnd(35, 70));
  let mug = sharp(imagePath).resize({ width: Math.round(430 * scale) });
  if (Math.random() < 0.5) mug = mug.modulate({ brightness: rnd(0.85, 1.15), saturation: rnd(0.85, 1.15) });
  const buf = await mug.png().toBuffer();
  return sharp(Buffer.from(scene()))
    .resize(800, 800)
    .composite([{ input: buf, gravity: "center" }])
    .rotate(angle, { background: { r: 110, g: 110, b: 100 } })
    .jpeg({ quality: q })
    .toBuffer();
}

const entries = [];
const vectors = [];
let dim = 0;
for (const e of master) {
  const views = [];
  for (let i = 0; i < AUGS; i++) views.push(await embed(await augment(path.join(ROOT, "public", e.image))));
  dim = views[0].length;
  const sum = new Array(dim).fill(0);
  for (const v of views) for (let j = 0; j < dim; j++) sum[j] += v[j];
  const proto = unit(sum);
  // Store compactly as base64 Float32.
  const f32 = new Float32Array(proto);
  vectors.push(Buffer.from(f32.buffer).toString("base64"));
  entries.push({ num: e.num, nameEn: e.nameEn, year: e.year, image: e.image });
  process.stdout.write(`\r  ${entries.length}/${master.length} ${e.nameEn}          `);
}
process.stdout.write("\n");

const payload = { model: MODEL, dim, count: entries.length, entries, vectors };
await writeFile(path.join(ROOT, "public/mug-embeddings.json"), JSON.stringify(payload));
const bytes = (await readFile(path.join(ROOT, "public/mug-embeddings.json"))).length;
console.log(`Wrote public/mug-embeddings.json — ${entries.length} mugs, dim ${dim}, ${(bytes / 1024).toFixed(0)} KB.`);
