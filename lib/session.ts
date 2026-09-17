import { auth } from "./auth";
import { headers } from "next/headers";
import { verifyImportToken } from "./import-token";

/**
 * The caller's owner key. Signed-in users own by their (lowercased) Google email;
 * everyone else owns by an anonymous per-device token (sent as the x-device-id
 * header, prefixed "anon:") so the app works without an account. Returns null only
 * when neither is present.
 *
 * DEV_OWNER is a local-development bypass; ignored on Vercel, never for production.
 */
export async function currentOwner(): Promise<string | null> {
  if (process.env.DEV_OWNER && !process.env.VERCEL) return process.env.DEV_OWNER.toLowerCase();
  const session = await auth();
  const email = session?.user?.email;
  if (email) return email.toLowerCase();
  const dev = headers().get("x-device-id");
  if (dev && /^[a-zA-Z0-9_-]{8,64}$/.test(dev)) return "anon:" + dev;
  return null;
}

/** The signed-in account email, or null when browsing anonymously. */
export async function currentAccount(): Promise<string | null> {
  if (process.env.DEV_OWNER && !process.env.VERCEL) return process.env.DEV_OWNER.toLowerCase();
  const session = await auth();
  return session?.user?.email ? session.user.email.toLowerCase() : null;
}

/** Small helper for route handlers: 401 JSON response for unidentifiable calls. */
export function unauthorized(): Response {
  return new Response(JSON.stringify({ error: "No device or session" }), {
    status: 401,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Owner from a browser-extension import token (`Authorization: Bearer …` or
 * `x-import-token`), or null when absent/invalid. Used by the import routes so
 * the extension doesn't need the app's session cookie.
 */
export async function ownerFromImportToken(req: Request): Promise<string | null> {
  const authz = req.headers.get("authorization") || "";
  const token = authz.replace(/^Bearer\s+/i, "").trim() || req.headers.get("x-import-token");
  return verifyImportToken(token);
}

/**
 * Owner for a route handler that may be hit by a plain <img>/<a> request, which
 * can't carry the x-device-id header — falls back to a `?d=` query param.
 */
export async function ownerFromRequest(req: Request): Promise<string | null> {
  const o = await currentOwner();
  if (o) return o;
  const d = new URL(req.url).searchParams.get("d");
  return d && /^[a-zA-Z0-9_-]{8,64}$/.test(d) ? "anon:" + d : null;
}
