import { createHash } from "crypto";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * eBay Marketplace Account Deletion / Closure notification endpoint.
 *
 * Required for a production eBay app to be "Compliant". Two behaviours:
 *
 *  1. GET  ?challenge_code=...  — eBay's ownership check. We must reply with
 *     { "challengeResponse": SHA256(challengeCode + verificationToken + endpoint) }
 *     as hex, HTTP 200, application/json.
 *
 *  2. POST — an account-deletion notification. This app stores no eBay user
 *     data (it only uses the Browse API with an application token), so there is
 *     nothing to delete; we log and acknowledge with 200.
 *
 * Config:
 *   EBAY_VERIFICATION_TOKEN   a token you choose (32–80 chars, [A-Za-z0-9_-]),
 *                             entered in the eBay portal's "Verification token".
 *   EBAY_DELETION_ENDPOINT    optional — the exact https URL you registered.
 *                             Defaults to this request's own URL (proto+host+path).
 */

function endpointUrl(req: Request, pathname: string): string {
  if (process.env.EBAY_DELETION_ENDPOINT) return process.env.EBAY_DELETION_ENDPOINT;
  const h = req.headers;
  const proto = h.get("x-forwarded-proto") || "https";
  const host = h.get("x-forwarded-host") || h.get("host") || "";
  return `${proto}://${host}${pathname}`;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const challengeCode = url.searchParams.get("challenge_code");
  if (!challengeCode) {
    // Not a challenge — a plain health check.
    return NextResponse.json({ ok: true, endpoint: "ebay-account-deletion" });
  }
  const token = process.env.EBAY_VERIFICATION_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "EBAY_VERIFICATION_TOKEN is not set on the server." }, { status: 500 });
  }
  const endpoint = endpointUrl(req, url.pathname);
  const challengeResponse = createHash("sha256")
    .update(challengeCode)
    .update(token)
    .update(endpoint)
    .digest("hex");
  return NextResponse.json({ challengeResponse }, { status: 200 });
}

export async function POST(req: Request) {
  // Account-deletion notification. We store no eBay user data → nothing to erase.
  try {
    const body = await req.json().catch(() => null);
    const username = body?.notification?.data?.username;
    console.log("eBay account-deletion notification received", username ? `for ${username}` : "");
  } catch {
    /* ignore malformed bodies — still acknowledge */
  }
  return new Response(null, { status: 200 });
}
