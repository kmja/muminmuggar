import { NextResponse } from "next/server";
import { listMasterCatalog } from "@/lib/catalog";
import { currentOwner, unauthorized } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** The full authoritative Moomin/Arabia catalogue (171 mugs) with resolved images. */
export async function GET() {
  if (!(await currentOwner())) return unauthorized();
  try {
    return NextResponse.json({ catalog: await listMasterCatalog() });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
