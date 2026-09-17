import { NextResponse } from "next/server";
import { createImportToken } from "@/lib/import-token";
import { currentOwner, unauthorized } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Mint a short-lived token the browser extension uses to upload a collection. */
export async function POST() {
  const owner = await currentOwner();
  if (!owner) return unauthorized();
  const { token, expiresAt } = createImportToken(owner);
  return NextResponse.json({ token, expiresAt });
}
