import { NextResponse } from "next/server";
import { deleteMug, getMug, updateMug } from "@/lib/mugs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const mug = await getMug(params.id);
    if (!mug) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ mug });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const patch = await req.json();
    const mug = await updateMug(params.id, patch);
    if (!mug) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ mug });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    await deleteMug(params.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
