import { NextResponse } from "next/server";
import { deepseekConfigured, deepseekMode, identifyMugsFromCatalog, identifyMugsFromCatalogImages } from "@/lib/deepseek";
import { resolveCandidate } from "@/lib/catalog";
import { currentOwner, unauthorized } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Design-"A" recognition engine: DeepSeek V4.1 Flash picks the catalogue entry
 * directly (returns a `num`) instead of naming a mug for us to fuzzy-match. One
 * photo may contain a single mug or a shelf, so this returns a `drafts` array —
 * the client routes both here when NEXT_PUBLIC_RECOGNITION_ENGINE=deepseek.
 */
export async function POST(req: Request) {
  if (!(await currentOwner())) return unauthorized();
  try {
    const { imageDataUrl } = await req.json();
    if (!imageDataUrl) return NextResponse.json({ error: "No image provided" }, { status: 400 });
    if (!deepseekConfigured()) {
      return NextResponse.json({ error: "DEEPSEEK_API_KEY is not set on the server." }, { status: 503 });
    }
    const matches = deepseekMode() === "text"
      ? await identifyMugsFromCatalog(imageDataUrl)
      : await identifyMugsFromCatalogImages(imageDataUrl);
    const drafts = matches.map((m) => {
      const cat = resolveCandidate(m.entry);
      return {
        name: cat.nameEn,
        series: "Arabia Moomin",
        edition: "",
        year: cat.year ?? "",
        status: "owned",
        condition: null,
        conditionNotes: "",
        currency: process.env.DEFAULT_CURRENCY || "SEK",
        photoUrl: imageDataUrl,
        estValueLow: cat.estLow,
        estValueHigh: cat.estHigh,
        estValueCurrency: "SEK",
        notes: "",
        tags: [],
        aiConfidence: m.confidence,
        isMoominMug: true,
        position: m.position,
        // Resolved catalogue entry (never null — unmatched mugs are omitted).
        catalog: cat,
        verified: false,
        verifyReason: m.reason,
        engine: "deepseek",
      };
    });
    return NextResponse.json({ drafts });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
