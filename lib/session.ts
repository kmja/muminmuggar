import { auth } from "./auth";
import { headers } from "next/headers";

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
