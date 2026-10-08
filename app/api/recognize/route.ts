import { NextResponse } from "next/server";
import { deepseekConfigured, identifyMugFromCatalog } from "@/lib/deepseek";
import { resolveCandidate } from "@/lib/catalog";
import { currentOwner, unauthorized } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Design-"A" recognition: DeepSeek V4.1 Flash picks the catalogue entry directly
 * (returns a `num`) instead of naming a mug for us to fuzzy-match. Single mugs
 * only — the shelf-scan route still handles multi-mug photos.
 */
export async function POST(req: Request) {
  if (!(await currentOwner())) return unauthorized();
  try {
    const { imageDataUrl } = await req.json();
    if (!imageDataUrl) return NextResponse.json({ error: "No image provided" }, { status: 400 });
    if (!deepseekConfigured()) {
      return NextResponse.json({ error: "DEEPSEEK_API_KEY is not set on the server." }, { status: 503 });
    }
    const match = await identifyMugFromCatalog(imageDataUrl);
    const cat = match.entry ? resolveCandidate(match.entry) : null;
    return NextResponse.json({
      draft: {
        name: cat ? cat.nameEn : "",
        series: "Arabia Moomin",
        edition: "",
        year: cat ? cat.year ?? "" : "",
        status: "owned",
        condition: null,
        conditionNotes: "",
        currency: process.env.DEFAULT_CURRENCY || "SEK",
        photoUrl: imageDataUrl,
        estValueLow: cat ? cat.estLow : null,
        estValueHigh: cat ? cat.estHigh : null,
        estValueCurrency: "SEK",
        notes: "",
        tags: [],
        aiConfidence: match.confidence,
        isMoominMug: !!cat,
        // Resolved catalogue entry (or null → the UI asks for a manual pick).
        catalog: cat,
        verified: false,
        verifyReason: match.reason,
        engine: "deepseek",
      },
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
