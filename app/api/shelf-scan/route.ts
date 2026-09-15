import { NextResponse } from "next/server";
import { identifyShelf } from "@/lib/gemini";
import { recognizeMug } from "@/lib/recognition";
import { currentOwner, unauthorized } from "@/lib/session";
import type { AiMug } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // identification + a visual verification pass

async function draft(ai: AiMug, imageDataUrl: string, verify: boolean) {
  const cur = ai.valueCurrency || process.env.DEFAULT_CURRENCY || "SEK";
  const rec = await recognizeMug(ai, imageDataUrl, { verify });
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
    photoUrl: "",
    estValueLow: e ? e.estLow : ai.estimatedValueLow ?? null,
    estValueHigh: e ? e.estHigh : ai.estimatedValueHigh ?? null,
    estValueCurrency: cur,
    notes: ai.notes || "",
    tags: [],
    // Calibrated confidence — never the model's raw (overconfident) number.
    aiConfidence: rec.confidence,
    isMoominMug: ai.isMoominMug !== false,
    position: ai.position || "",
    // Resolved + visually verified catalogue entry; null → the UI forces a manual pick.
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
    const results = await identifyShelf(imageDataUrl);
    // Visual verification is only meaningful for a single-mug photo; on a shelf
    // the user reviews each row, so we skip it and stay conservative.
    const single = results.length === 1;
    const drafts = await Promise.all(results.map((ai) => draft(ai, imageDataUrl, single)));
    return NextResponse.json({ drafts });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
