import base from "./probe-base.json";

/**
 * Server-side probe maths for on-site fine-tuning. The base normal equations
 * (XtX, XtY) come from the synthetic augmentation build; real labels from the
 * deployed app are added to them and the ridge solution is re-derived.
 */
export interface LabelSample { c: number; x: number[] }

export function decodeF32(b64: string): Float32Array {
  const buf = Buffer.from(b64, "base64");
  return new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));
}
export function encodeF32(arr: Float32Array | Float64Array): string {
  return Buffer.from(new Float32Array(arr).buffer).toString("base64");
}
export function decodeEmbedding(b64: string): number[] {
  const f = decodeF32(b64);
  let n = 0; for (const x of f) n += x * x;
  n = Math.sqrt(n) || 1;
  return Array.from(f, (x) => x / n);
}

/** Decode an embedding only if it matches the probe's feature dimension. */
export function decodeSample(b64: string, dim: number): number[] | null {
  try {
    const x = decodeEmbedding(b64);
    return x.length === dim ? x : null;
  } catch {
    return null;
  }
}

function logits(W: Float32Array | Float64Array, x: number[]): Float64Array {
  const D = base.dim, C = base.count;
  const s = new Float64Array(C);
  for (let a = 0; a < D; a++) { const va = x[a]; if (!va) continue; const off = a * C; for (let c = 0; c < C; c++) s[c] += va * W[off + c]; }
  const o = D * C; for (let c = 0; c < C; c++) s[c] += W[o + c];
  return s;
}

export function evaluate(W: Float32Array | Float64Array, samples: LabelSample[]) {
  let top1 = 0, top5 = 0; const margins: { ok: boolean; m: number }[] = [];
  for (const s of samples) {
    const ranked = Array.from(logits(W, s.x), (v, c) => ({ c, v })).sort((a, b) => b.v - a.v);
    const ok = ranked[0].c === s.c;
    if (ok) top1++;
    if (ranked.slice(0, 5).some((z) => z.c === s.c)) top5++;
    margins.push({ ok, m: ranked[0].v - ranked[1].v });
  }
  return { top1, top5, n: samples.length, margins };
}

/** Re-solve the ridge probe with real labels (weighted) added to the base prior. */
export function solveWithLabels(samples: LabelSample[], weight: number, lambda: number): Float64Array {
  const D = base.dim, C = base.count, Dp = D + 1;
  const XtX = Float64Array.from(decodeF32(base.xtx));
  const XtY = Float64Array.from(decodeF32(base.xty));
  for (const s of samples) {
    const xa = new Float64Array(Dp);
    for (let i = 0; i < Math.min(s.x.length, D); i++) xa[i] = s.x[i];
    xa[D] = 1;
    for (let a = 0; a < Dp; a++) { const va = weight * xa[a]; for (let b = a; b < Dp; b++) XtX[a * Dp + b] += va * xa[b]; XtY[a * C + s.c] += va; }
  }
  const A = Float64Array.from(XtX);
  for (let a = 0; a < Dp; a++) for (let b = 0; b < a; b++) A[a * Dp + b] = A[b * Dp + a];
  for (let a = 0; a < Dp; a++) A[a * Dp + a] += lambda;
  const inv = invert(A, Dp);
  const W = new Float64Array(Dp * C);
  for (let a = 0; a < Dp; a++) for (let k = 0; k < Dp; k++) { const ia = inv[a * Dp + k]; if (!ia) continue; for (let c = 0; c < C; c++) W[a * C + c] += ia * XtY[k * C + c]; }
  return W;
}

function invert(A: Float64Array, n: number): Float64Array {
  const M = Float64Array.from(A), I = new Float64Array(n * n);
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

export { base };
