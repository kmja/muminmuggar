import { NextResponse } from "next/server";
import { catalogCount, syncCatalogOnce } from "@/lib/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // fetches several pages of the official product feed

/** How many official product images we have stored. */
export async function GET() {
  try {
    return NextResponse.json({ count: await catalogCount() });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

/** (Re)populate the stored catalog from the official shop's product feed. */
export async function POST() {
  try {
    const result = await syncCatalogOnce();
    return NextResponse.json({ ...result, count: await catalogCount() });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
