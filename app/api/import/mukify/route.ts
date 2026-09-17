import { NextResponse } from "next/server";
import { listMugs } from "@/lib/mugs";
import { importMukify, type MukifyItem } from "@/lib/mukify-import";
import { currentOwner, ownerFromImportToken, unauthorized } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Import a collection exported from Mukify by the browser bookmarklet. The user
 * runs the bookmarklet on mukify.com (so their session stays in their browser)
 * and pastes the resulting JSON here — we never handle Mukify credentials.
 */
export async function POST(req: Request) {
  const owner = (await currentOwner()) || (await ownerFromImportToken(req));
  if (!owner) return unauthorized();
  try {
    const body = await req.json();
    const items: MukifyItem[] = Array.isArray(body?.items) ? body.items : [];
    if (!items.length) return NextResponse.json({ error: "No items to import" }, { status: 400 });
    const currency = typeof body?.currency === "string" && body.currency ? body.currency : "SEK";
    const existing = await listMugs(owner);
    const result = await importMukify(items, owner, existing, currency);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
