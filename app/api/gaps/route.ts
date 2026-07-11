import { NextResponse } from "next/server";
import { findSeriesMugs } from "@/lib/gemini";
import { currentOwner, unauthorized } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await currentOwner())) return unauthorized();
  try {
    const { series } = await req.json();
    if (!series) return NextResponse.json({ error: "No series provided" }, { status: 400 });
    const catalog = await findSeriesMugs(String(series));
    return NextResponse.json({ catalog });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
