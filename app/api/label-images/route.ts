import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { currentOwner, unauthorized } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The owner's uploaded labeling photos. */
export async function GET() {
  const owner = await currentOwner();
  if (!owner) return unauthorized();
  const { rows } = await query("SELECT id, name FROM label_images WHERE owner = $1 ORDER BY id", [owner]);
  return NextResponse.json({ images: rows.map((r) => ({ id: Number(r.id), name: String(r.name) })) });
}

/** Upload one photo (base64, no data: prefix). */
export async function POST(req: Request) {
  const owner = await currentOwner();
  if (!owner) return unauthorized();
  try {
    const b = await req.json();
    const data = typeof b.data === "string" ? b.data : "";
    if (!data) return NextResponse.json({ error: "data required" }, { status: 400 });
    if (data.length > 3_000_000) return NextResponse.json({ error: "image too large" }, { status: 413 });
    const { rows } = await query(
      "INSERT INTO label_images (owner, name, mime, data) VALUES ($1,$2,$3,$4) RETURNING id",
      [owner, String(b.name || "photo").slice(0, 200), typeof b.mime === "string" ? b.mime.slice(0, 60) : null, data],
    );
    return NextResponse.json({ id: Number(rows[0].id) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

/** Remove all of the owner's uploaded photos (and their labels, via cascade). */
export async function DELETE() {
  const owner = await currentOwner();
  if (!owner) return unauthorized();
  try {
    await query("DELETE FROM label_images WHERE owner = $1", [owner]);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
