import { NextResponse } from "next/server";
import { deleteMug, getMug, updateMug } from "@/lib/mugs";
import { currentOwner, unauthorized } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const owner = await currentOwner();
  if (!owner) return unauthorized();
  try {
    const mug = await getMug(params.id, owner);
    if (!mug) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ mug });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const owner = await currentOwner();
  if (!owner) return unauthorized();
  try {
    const patch = await req.json();
    const mug = await updateMug(params.id, patch, owner);
    if (!mug) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ mug });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const owner = await currentOwner();
  if (!owner) return unauthorized();
  try {
    await deleteMug(params.id, owner);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
