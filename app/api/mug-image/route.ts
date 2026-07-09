import { NextResponse } from "next/server";
import { findMugImage } from "@/lib/mugimage";
import { setMugPhoto } from "@/lib/mugs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // grounded search + a few page fetches

/**
 * Find a product image for a mug. If an `id` is supplied and an image is
 * found, it's persisted to that mug (quietly, without reordering). Used to
 * illustrate the batch-scan checklist and to backfill collection thumbnails.
 */
export async function POST(req: Request) {
  try {
    const { id, name, series, year } = await req.json();
    if (!name || !String(name).trim()) return NextResponse.json({ error: "name required" }, { status: 400 });
    const imageUrl = await findMugImage({ name, series, year });
    if (imageUrl && id) {
      try { await setMugPhoto(String(id), imageUrl); } catch (e) { console.error("setMugPhoto:", e); }
    }
    return NextResponse.json({ imageUrl });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
