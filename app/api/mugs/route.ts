import { NextResponse } from "next/server";
import { createMug, listMugs } from "@/lib/mugs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const mugs = await listMugs();
    return NextResponse.json({ mugs });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const mug = await createMug(body);
    return NextResponse.json({ mug }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
