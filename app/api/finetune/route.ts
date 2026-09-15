import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { currentOwner, unauthorized } from "@/lib/session";
import { base, decodeEmbedding, encodeF32, evaluate, solveWithLabels, type LabelSample } from "@/lib/probe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CLS = new Map(base.entries.map((e, i) => [e.num, i]));

async function loadSamples(owner: string): Promise<LabelSample[]> {
  const { rows } = await query(
    "SELECT chosen_num, embedding FROM labels WHERE owner = $1 AND chosen_num IS NOT NULL AND embedding IS NOT NULL",
    [owner],
  );
  const out: LabelSample[] = [];
  for (const r of rows) {
    const c = CLS.get(Number(r.chosen_num));
    if (c == null) continue;
    try { out.push({ c, x: decodeEmbedding(String(r.embedding)) }); } catch { /* skip */ }
  }
  return out;
}

/**
 * Fine-tune the probe with the owner's labels (weighted) added to the synthetic
 * prior, cross-validate it, and store the result as the owner's custom model.
 */
export async function POST(req: Request) {
  const owner = await currentOwner();
  if (!owner) return unauthorized();
  try {
    const samples = await loadSamples(owner);
    if (samples.length < 4) return NextResponse.json({ error: "Need at least 4 labeled photos." }, { status: 400 });

    // Cross-validate the fine-tune on the real labels, tuning how strongly they
    // override the synthetic prior (a handful of real photos shouldn't be
    // over-weighted, but should be able to move the probe).
    const k = samples.length <= 25 ? samples.length : 5;
    const shuffled = [...samples].sort(() => Math.random() - 0.5);
    const folds: LabelSample[][] = Array.from({ length: k }, () => []);
    shuffled.forEach((s, i) => folds[i % k].push(s));

    let best = { weight: 10, top1: -1, top5: -1 };
    for (const w of [5, 10, 25, 50, 100]) {
      let ct1 = 0, ct5 = 0;
      for (let f = 0; f < k; f++) {
        const train = folds.filter((_, g) => g !== f).flat();
        const ev = evaluate(solveWithLabels(train, w, base.lambda), folds[f]);
        ct1 += ev.top1; ct5 += ev.top5;
      }
      if (ct1 > best.top1 || (ct1 === best.top1 && ct5 > best.top5)) best = { weight: w, top1: ct1, top5: ct5 };
    }

    // Fit on everything with the chosen weight and store.
    const W = solveWithLabels(samples, best.weight, base.lambda);
    const ev = evaluate(W, samples);
    const uniq = [...new Set(ev.margins.map((m) => m.m))].sort((a, b) => b - a);
    let autoMargin = base.autoMargin;
    for (const m of uniq) {
      const acc = ev.margins.filter((x) => x.m >= m);
      if (acc.filter((x) => x.ok).length / acc.length >= 0.98) autoMargin = m; else break;
    }
    await query(
      `INSERT INTO mug_models (owner, weights, auto_margin, temperature, updated_at)
       VALUES ($1,$2,$3,$4, now())
       ON CONFLICT (owner) DO UPDATE SET
         weights = EXCLUDED.weights, auto_margin = EXCLUDED.auto_margin, temperature = EXCLUDED.temperature, updated_at = now()`,
      [owner, encodeF32(W), autoMargin, base.temperature],
    );
    return NextResponse.json({ ok: true, n: samples.length, weight: best.weight, cv: { top1: best.top1, top5: best.top5 }, autoMargin });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
