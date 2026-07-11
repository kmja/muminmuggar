import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { query } from "@/lib/db";
import { currentAccount } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Move this device's anonymous collection onto the signed-in account. */
export async function POST() {
  const account = await currentAccount();
  if (!account) return NextResponse.json({ moved: 0 });
  const dev = headers().get("x-device-id");
  if (!dev || !/^[a-zA-Z0-9_-]{8,64}$/.test(dev)) return NextResponse.json({ moved: 0 });
  const anon = "anon:" + dev;
  try {
    const r = await query("UPDATE mugs SET owner = $1 WHERE owner = $2", [account, anon]);
    await query("UPDATE push_subscriptions SET owner = $1 WHERE owner = $2", [account, anon]);
    return NextResponse.json({ moved: r.rowCount || 0 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
