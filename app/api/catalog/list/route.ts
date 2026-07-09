import { NextResponse } from "next/server";
import { listMasterCatalog } from "@/lib/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** The full authoritative Moomin/Arabia catalogue (171 mugs) with resolved images. */
export async function GET() {
  try {
    return NextResponse.json({ catalog: await listMasterCatalog() });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
