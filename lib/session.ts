import { auth } from "./auth";

/**
 * The signed-in user's owner key (lowercased Google email), or null if not signed
 * in. Data access is scoped to this value.
 *
 * DEV_OWNER is a local-development bypass so the app can run without Google
 * credentials; it is ignored on Vercel and must never be set in production.
 */
export async function currentOwner(): Promise<string | null> {
  if (process.env.DEV_OWNER && !process.env.VERCEL) return process.env.DEV_OWNER.toLowerCase();
  const session = await auth();
  const email = session?.user?.email;
  return email ? email.toLowerCase() : null;
}

/** Small helper for route handlers: 401 JSON response for unauthenticated calls. */
export function unauthorized(): Response {
  return new Response(JSON.stringify({ error: "Sign in required" }), {
    status: 401,
    headers: { "content-type": "application/json" },
  });
}
