// Shared Node-side matcher: the same DINOv2-small + ridge probe the app runs in
// the browser, so labels and evaluation use identical features.
import { pipeline, RawImage } from "@huggingface/transformers";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import sharp from "sharp";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const unit = (v) => { let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1; return v.map((x) => x / n); };

export async function createMatcher() {
  const index = JSON.parse(await readFile(path.join(ROOT, "public/mug-embeddings.json"), "utf8"));
  const D = index.dim, C = index.count;
  const buf = Buffer.from(index.weights, "base64");
  const W = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  const ex = await pipeline("image-feature-extraction", index.model, { dtype: "q8" });

  async function embed(input) {
    const jpeg = await sharp(input).rotate().resize({ width: 1024, withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
    const out = await ex(await RawImage.fromBlob(new Blob([jpeg])), { pooling: "mean", normalize: true });
    const raw = out.data.length > D ? out.data.slice(0, D) : out.data;
    return unit(Array.from(raw));
  }

  function rank(x, k = 4) {
    const logits = new Float64Array(C);
    for (let a = 0; a < D; a++) { const xa = x[a]; if (!xa) continue; const off = a * C; for (let c = 0; c < C; c++) logits[c] += xa * W[off + c]; }
    const boff = D * C; for (let c = 0; c < C; c++) logits[c] += W[boff + c];
    const ranked = index.entries.map((e, i) => ({ ...e, logit: logits[i] }));
    ranked.sort((a, b) => b.logit - a.logit);
    return ranked.slice(0, k);
  }

  function b64(x) { return Buffer.from(new Float32Array(x).buffer).toString("base64"); }

  return { embed, rank, b64, index };
}

export { ROOT };
