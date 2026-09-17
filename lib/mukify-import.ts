import { fold, listMasterCatalog, resolveMug } from "./catalog";
import { createMug } from "./mugs";
import type { Mug } from "./types";

/**
 * Import a Mukify collection export into our mugs. The export is produced by the
 * bookmarklet the user runs while logged in to mukify.com (see the Import dialog),
 * so we never see their credentials — we only receive the normalised JSON.
 *
 * Items are matched to our catalogue by Mukify serial number (falling back to a
 * name match), then created as owned/wishlist mugs. Mugs already present (same
 * folded name) are skipped.
 */

export interface MukifyItem {
  serial?: number | null;
  name?: string | null;
  wishlist?: boolean;
  boughtPrice?: string | number | null;
  boughtDate?: string | null;
  comment?: string | null;
  stickered?: boolean;
  signed?: boolean;
  misprinted?: boolean;
}

export interface MukifyImportResult {
  total: number;
  created: number;
  skipped: number;
  unmatched: number;
  names: string[];
}

// Same ownership key the client uses: folded name minus filler words/spacing.
const STOP = new Set(["and", "the", "with", "of", "in", "on", "a", "x", "mug"]);
export const ownKey = (s: unknown): string =>
  fold(s).split(" ").filter((x) => x && !STOP.has(x)).join("");

const toPrice = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/[^0-9.,-]/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
};
const toDate = (v: unknown): string | null => {
  const s = v ? String(v).slice(0, 10) : "";
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};

export async function importMukify(
  items: MukifyItem[],
  owner: string,
  existing: Mug[],
  currency = "SEK",
): Promise<MukifyImportResult> {
  const catalog = await listMasterCatalog();
  const byNum = new Map(catalog.map((e) => [e.num, e]));
  const seen = new Set(existing.map((m) => ownKey(m.name)).filter(Boolean));
  const result: MukifyImportResult = { total: items.length, created: 0, skipped: 0, unmatched: 0, names: [] };

  for (const it of items) {
    const bySerial = it.serial != null ? byNum.get(Number(it.serial)) : null;
    const resolved = bySerial || resolveMug({ name: String(it.name || ""), year: null, series: null, edition: null });
    const name = resolved ? resolved.nameEn : String(it.name || "").trim();
    if (!name) { result.unmatched++; continue; }

    const key = ownKey(name);
    if (key && seen.has(key)) { result.skipped++; continue; }

    const flags = [
      it.stickered ? "stickered" : "",
      it.signed ? "signed" : "",
      it.misprinted ? "misprinted" : "",
    ].filter(Boolean);
    const notes = [it.comment ? String(it.comment).trim() : "", flags.length ? `Mukify: ${flags.join(", ")}` : ""]
      .filter(Boolean).join("\n");

    await createMug({
      name,
      series: "Arabia Moomin",
      year: resolved?.year ?? null,
      status: it.wishlist ? "wishlist" : "owned",
      price: toPrice(it.boughtPrice),
      currency,
      acquiredDate: toDate(it.boughtDate),
      hasTag: !!it.stickered,
      notes: notes || null,
      photoUrl: resolved?.image ?? null,
      estValueLow: resolved?.estLow ?? null,
      estValueHigh: resolved?.estHigh ?? null,
      estValueCurrency: resolved?.estCur ?? null,
    }, owner);

    if (key) seen.add(key);
    result.created++;
    if (result.names.length < 8) result.names.push(name);
  }
  return result;
}
