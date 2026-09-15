import { catalogCandidates, resolveCandidate, readCatalogImage, type ResolvedMug } from "./catalog";
import { verifyMug, geminiConfigured } from "./gemini";
import type { AiMug } from "./types";

export interface Recognition {
  /** The catalogue entry to trust, or null when we can't confirm a match. */
  catalog: ResolvedMug | null;
  /** Calibrated 0–1 confidence (never 1.0), or null when there is no match. */
  confidence: number | null;
  /** True when the match was confirmed against the catalogue image. */
  verified: boolean;
  reason: "verified" | "ambiguous" | "unverified" | "no-candidates";
}

const clamp = (n: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, n));

/**
 * Resolve a Gemini identification to a catalogue entry we can actually trust.
 *
 * A fuzzy name match is not enough: many mugs share a character but differ in
 * artwork, and Gemini's self-reported confidence is unreliable. So we build a
 * shortlist of plausible catalogue entries (unique images only) and, for a
 * single-mug photo, ask Gemini to visually confirm which reference — if any —
 * shows the exact same design. Only a confirmed match is auto-filled; anything
 * else returns null so the UI asks the user to pick.
 */
export async function recognizeMug(ai: AiMug, photoDataUrl: string, opts: { verify?: boolean } = {}): Promise<Recognition> {
  const query = { name: ai.character || "", year: ai.year ?? null, edition: ai.edition || "" };
  const candidates = catalogCandidates(query, 5);
  const aiConf = clamp(typeof ai.confidence === "number" && Number.isFinite(ai.confidence) ? ai.confidence : 0.5, 0, 0.9);

  if (!candidates.length) return { catalog: null, confidence: null, verified: false, reason: "no-candidates" };

  // Visual verification against the catalogue images (the accuracy backstop).
  if (opts.verify !== false && geminiConfigured()) {
    const refs: { entry: (typeof candidates)[number]["entry"]; imageDataUrl: string }[] = [];
    for (const c of candidates) {
      const imageDataUrl = await readCatalogImage(c.entry.image || "");
      if (imageDataUrl) refs.push({ entry: c.entry, imageDataUrl });
    }
    if (refs.length) {
      try {
        const vr = await verifyMug(photoDataUrl, refs.map((r) => ({ name: r.entry.nameEn, year: r.entry.year, imageDataUrl: r.imageDataUrl })));
        if (vr && vr.index >= 0 && vr.index < refs.length && vr.confidence >= 0.5) {
          const vConf = clamp(vr.confidence);
          return { catalog: resolveCandidate(refs[vr.index].entry), confidence: clamp(0.35 + 0.35 * vConf + 0.25 * aiConf, 0, 0.95), verified: true, reason: "verified" };
        }
        // The model couldn't confirm a design — fall through to the conservative
        // name-match path rather than hard-blocking (real photos are noisy).
      } catch {
        /* fall through to the conservative, unverified path */
      }
    }
  }

  // No visual check available: only auto-fill when a single candidate clearly wins.
  const [top, second] = candidates;
  if (second && top.score - second.score < 0.75) {
    return { catalog: null, confidence: null, verified: false, reason: "ambiguous" };
  }
  return { catalog: resolveCandidate(top.entry), confidence: clamp(0.3 + 0.4 * aiConf, 0, 0.75), verified: false, reason: "unverified" };
}
