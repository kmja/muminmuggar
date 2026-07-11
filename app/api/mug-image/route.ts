import { NextResponse } from "next/server";
import { catalogImage, catalogYear, catalogValue } from "@/lib/catalog";
import { setMugPhoto, setMugYear, setMugValue, getMug } from "@/lib/mugs";
import { currentOwner, unauthorized } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // may trigger a one-time catalog sync on first use

/**
 * Return the official product image for a mug from our stored catalog (no
 * per-mug web/Gemini search). If an `id` is supplied and an image is found,
 * it's persisted to that mug (quietly, without reordering the collection).
 */
export async function POST(req: Request) {
  const owner = await currentOwner();
  if (!owner) return unauthorized();
  try {
    const { id, name, series, year, edition } = await req.json();
    if (!name || !String(name).trim()) return NextResponse.json({ error: "name required" }, { status: 400 });
    const imageUrl = await catalogImage({ name, series, year, edition });
    const yr = catalogYear({ name, year, edition });
    const value = catalogValue({ name, year, edition });
    // Only persist onto a mug the caller actually owns.
    if (id && (await getMug(String(id), owner))) {
      try {
        if (imageUrl) await setMugPhoto(String(id), imageUrl);
        if (yr) await setMugYear(String(id), yr);
        if (value && (value.low != null || value.high != null)) await setMugValue(String(id), value.low, value.high, value.cur);
      } catch (e) { console.error("persist catalog data:", e); }
    }
    return NextResponse.json({ imageUrl, year: yr, value });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
