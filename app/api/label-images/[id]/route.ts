import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { ownerFromRequest } from "@/lib/session";

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
