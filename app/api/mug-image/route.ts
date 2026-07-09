import { NextResponse } from "next/server";
import { catalogImage, catalogYear, catalogValue } from "@/lib/catalog";
import { setMugPhoto, setMugYear, setMugValue } from "@/lib/mugs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // may trigger a one-time catalog sync on first use

/**
 * Return the official product image for a mug from our stored catalog (no
 * per-mug web/Gemini search). If an `id` is supplied and an image is found,
 * it's persisted to that mug (quietly, without reordering the collection).
 */
export async function POST(req: Request) {
  try {
    const { id, name, series, year } = await req.json();
    if (!name || !String(name).trim()) return NextResponse.json({ error: "name required" }, { status: 400 });
    const imageUrl = await catalogImage({ name, series, year });
    const yr = catalogYear({ name, year });
    const value = catalogValue({ name, year });
    if (id) {
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
