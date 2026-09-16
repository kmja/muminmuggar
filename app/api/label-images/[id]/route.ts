import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { ownerFromRequest, currentOwner, unauthorized } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Serve one uploaded labeling photo (owner-scoped; `?d=` for anonymous <img>). */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const owner = await ownerFromRequest(req);
  if (!owner) return new NextResponse("unauthorized", { status: 401 });
  const id = Number(params.id);
  if (!Number.isInteger(id)) return new NextResponse("bad id", { status: 400 });
  const { rows } = await query("SELECT mime, data FROM label_images WHERE id = $1 AND owner = $2", [id, owner]);
  if (!rows.length) return new NextResponse("not found", { status: 404 });
  const buf = Buffer.from(String(rows[0].data), "base64");
  return new NextResponse(buf, { headers: { "content-type": String(rows[0].mime || "image/jpeg"), "cache-control": "private, max-age=3600" } });
}

/** Remove one uploaded photo (its label cascades). */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const owner = await currentOwner();
  if (!owner) return unauthorized();
  const id = Number(params.id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  try {
    await query("DELETE FROM label_images WHERE id = $1 AND owner = $2", [id, owner]);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
