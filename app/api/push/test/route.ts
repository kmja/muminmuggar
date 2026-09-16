import { NextResponse } from "next/server";
import { currentOwner, unauthorized } from "@/lib/session";
import { sendToOwner, pushConfigured } from "@/lib/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Send a one-off push to every device subscribed by the current owner. */
export async function POST() {
  const owner = await currentOwner();
  if (!owner) return unauthorized();
  if (!pushConfigured()) return NextResponse.json({ error: "Push not configured" }, { status: 400 });
  const sent = await sendToOwner(owner, {
    title: "Moomin mugs",
    body: "Test notification — push is working. 🫖",
    url: "/?tab=wishlist",
  });
  return NextResponse.json({ ok: true, sent });
}
