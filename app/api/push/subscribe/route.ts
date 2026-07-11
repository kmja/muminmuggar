import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { currentOwner, unauthorized } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const owner = await currentOwner();
  if (!owner) return unauthorized();
  try {
    const sub = await req.json();
    const endpoint = sub?.endpoint;
    const p256dh = sub?.keys?.p256dh;
    const auth = sub?.keys?.auth;
    if (!endpoint || !p256dh || !auth) {
      return NextResponse.json({ error: "Invalid subscription" }, { status: 400 });
    }
    await query(
      `INSERT INTO push_subscriptions (owner, endpoint, p256dh, auth)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (endpoint) DO UPDATE SET owner = EXCLUDED.owner, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
      [owner, endpoint, p256dh, auth],
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { endpoint } = await req.json();
    if (endpoint) await query("DELETE FROM push_subscriptions WHERE endpoint = $1", [endpoint]);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
