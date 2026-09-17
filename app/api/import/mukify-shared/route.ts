import { NextResponse } from "next/server";
import { listMugs } from "@/lib/mugs";
import { importFromMukifyUser } from "@/lib/mukify-shared";
import { currentOwner, unauthorized } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Import a Mukify collection by the user's public username — no bookmarklet or
 * credentials needed. Requires the collection/wishlist to be shared on Mukify.
 */
export async function POST(req: Request) {
  const owner = await currentOwner();
  if (!owner) return unauthorized();
  try {
    const body = await req.json();
    const username = String(body?.username || "").trim().replace(/^@/, "");
    if (!username) return NextResponse.json({ error: "No username" }, { status: 400 });
    const types = Array.isArray(body?.types) && body.types.length ? body.types.map(String) : ["1", "2"];
    const existing = await listMugs(owner);
    const result = await importFromMukifyUser(username, owner, existing, types);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
