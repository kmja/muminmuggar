import { NextResponse } from "next/server";
import { identifyMug } from "@/lib/gemini";
import { resolveMug } from "@/lib/catalog";
import type { AiMug } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Turn a Gemini identification into a Mug draft (not persisted). */
function draft(ai: AiMug, photoUrl: string) {
  const cur = ai.valueCurrency || process.env.DEFAULT_CURRENCY || "SEK";
  return {
    name: ai.character || "",
    series: ai.series || "Arabia Moomin",
    edition: ai.edition || "",
    year: ai.year ?? "",
    status: "owned",
    condition: ai.condition || "Good",
    conditionNotes: ai.conditionNotes || "",
    currency: process.env.DEFAULT_CURRENCY || "SEK",
    photoUrl,
    estValueLow: ai.estimatedValueLow ?? null,
    estValueHigh: ai.estimatedValueHigh ?? null,
    estValueCurrency: cur,
    notes: ai.notes || "",
    tags: [],
    aiConfidence: ai.confidence ?? null,
    isMoominMug: ai.isMoominMug !== false,
    catalog: resolveMug({ name: ai.character || "", year: ai.year ?? null, edition: ai.edition || "" }),
  };
}

export async function POST(req: Request) {
  try {
    const { imageDataUrl } = await req.json();
    if (!imageDataUrl) return NextResponse.json({ error: "No image provided" }, { status: 400 });
    const ai = await identifyMug(imageDataUrl);
    return NextResponse.json({ draft: draft(ai, imageDataUrl) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
