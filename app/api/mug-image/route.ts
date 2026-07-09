import { NextResponse } from "next/server";
import { catalogImage } from "@/lib/catalog";
import { setMugPhoto } from "@/lib/mugs";

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
    if (imageUrl && id) {
      try { await setMugPhoto(String(id), imageUrl); } catch (e) { console.error("setMugPhoto:", e); }
    }
    return NextResponse.json({ imageUrl });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
