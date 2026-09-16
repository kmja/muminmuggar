import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { currentOwner, unauthorized } from "@/lib/session";
import { base, decodeF32, decodeSample, evaluate, type LabelSample } from "@/lib/probe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
    const x = decodeSample(String(r.embedding), base.dim);
    if (x) out.push({ c, x });
  }
  return out;
}

/** The owner's effective model: whether it's customised, and its accuracy on their labels. */
export async function GET() {
  const owner = await currentOwner();
  if (!owner) return unauthorized();
  const { rows } = await query("SELECT weights, auto_margin, temperature FROM mug_models WHERE owner = $1", [owner]);
  const expected = (base.dim + 1) * base.count;
  const stored = rows.length ? decodeF32(String(rows[0].weights)) : null;
  // Ignore a model trained against an older catalogue size.
  const custom = !!(stored && stored.length === expected);
  const W = custom ? (stored as Float32Array) : decodeF32(base.weights);
  const ev = evaluate(W, await loadSamples(owner));
  return NextResponse.json({
    custom,
    autoMargin: custom && rows[0].auto_margin != null ? Number(rows[0].auto_margin) : base.autoMargin,
    temperature: custom && rows[0].temperature != null ? Number(rows[0].temperature) : base.temperature,
    accuracy: { n: ev.n, top1: ev.top1, top5: ev.top5 },
  });
}

/** Reset to the default (built-in) model. */
export async function DELETE() {
  const owner = await currentOwner();
  if (!owner) return unauthorized();
  await query("DELETE FROM mug_models WHERE owner = $1", [owner]);
  return NextResponse.json({ ok: true });
}
