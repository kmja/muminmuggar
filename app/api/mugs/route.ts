import { NextResponse } from "next/server";
import { createMug, listMugs } from "@/lib/mugs";
import { currentOwner, unauthorized } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const owner = await currentOwner();
  if (!owner) return unauthorized();
  try {
    const mugs = await listMugs(owner);
    return NextResponse.json({ mugs });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const owner = await currentOwner();
  if (!owner) return unauthorized();
  try {
    const body = await req.json();
    const mug = await createMug(body, owner);
    return NextResponse.json({ mug }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
