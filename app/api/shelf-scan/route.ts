import { NextResponse } from "next/server";
import { identifyShelf } from "@/lib/gemini";
import { resolveMug } from "@/lib/catalog";
import { currentOwner, unauthorized } from "@/lib/session";
import type { AiMug } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function draft(ai: AiMug) {
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
    photoUrl: "",
    estValueLow: ai.estimatedValueLow ?? null,
    estValueHigh: ai.estimatedValueHigh ?? null,
    estValueCurrency: cur,
    notes: ai.notes || "",
    tags: [],
    aiConfidence: ai.confidence ?? null,
    isMoominMug: ai.isMoominMug !== false,
    position: ai.position || "",
    // Resolve to a catalogue entry; null → the UI forces a manual pick.
    catalog: resolveMug({ name: ai.character || "", year: ai.year ?? null, edition: ai.edition || "" }),
  };
}

export async function POST(req: Request) {
  if (!(await currentOwner())) return unauthorized();
  try {
    const { imageDataUrl } = await req.json();
    if (!imageDataUrl) return NextResponse.json({ error: "No image provided" }, { status: 400 });
    const results = await identifyShelf(imageDataUrl);
    return NextResponse.json({ drafts: results.map(draft) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
