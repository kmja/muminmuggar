import { NextResponse } from "next/server";
import { identifyMug } from "@/lib/gemini";
import { recognizeMug } from "@/lib/recognition";
import { currentOwner, unauthorized } from "@/lib/session";
import type { AiMug } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // identification + a visual verification pass

/** Turn a Gemini identification into a Mug draft (not persisted). */
async function draft(ai: AiMug, photoUrl: string) {
  const cur = ai.valueCurrency || process.env.DEFAULT_CURRENCY || "SEK";
  const rec = await recognizeMug(ai, photoUrl, { verify: true });
  const e = rec.catalog;
  return {
    name: e ? e.nameEn : ai.character || "",
    series: ai.series || "Arabia Moomin",
    edition: ai.edition || "",
    year: e ? e.year ?? "" : ai.year ?? "",
    status: "owned",
    condition: ai.condition || "Good",
    conditionNotes: ai.conditionNotes || "",
    currency: process.env.DEFAULT_CURRENCY || "SEK",
    photoUrl,
    estValueLow: e ? e.estLow : ai.estimatedValueLow ?? null,
    estValueHigh: e ? e.estHigh : ai.estimatedValueHigh ?? null,
    estValueCurrency: cur,
    notes: ai.notes || "",
    tags: [],
    aiConfidence: rec.confidence,
    isMoominMug: ai.isMoominMug !== false,
    catalog: e,
    verified: rec.verified,
    verifyReason: rec.reason,
  };
}

export async function POST(req: Request) {
  if (!(await currentOwner())) return unauthorized();
  try {
    const { imageDataUrl } = await req.json();
    if (!imageDataUrl) return NextResponse.json({ error: "No image provided" }, { status: 400 });
    const ai = await identifyMug(imageDataUrl);
    return NextResponse.json({ draft: await draft(ai, imageDataUrl) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
