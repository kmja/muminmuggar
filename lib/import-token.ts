import { createHmac, timingSafeEqual } from "crypto";

/**
 * Stateless, short-lived import tokens for the browser extension. The user taps
 * "Connect extension" in the app (while signed in / on their device), which mints
 * a token bound to their owner id; the extension stores it and sends it as a
 * header when uploading a Mukify collection. No session cookie needed.
 */

const secret = (): string =>
  process.env.IMPORT_TOKEN_SECRET || process.env.AUTH_SECRET || "muminmuggar-dev-import-secret";

const sign = (payload: string): string => createHmac("sha256", secret()).update(payload).digest("base64url");

export interface ImportToken {
  token: string;
  expiresAt: number;
}

export function createImportToken(owner: string, ttlMs = 24 * 60 * 60 * 1000): ImportToken {
  const expiresAt = Date.now() + ttlMs;
  const payload = `${Buffer.from(owner, "utf8").toString("base64url")}.${expiresAt}`;
  return { token: `${payload}.${sign(payload)}`, expiresAt };
}

/** Returns the owner id the token was minted for, or null when invalid/expired. */
export function verifyImportToken(token: string | null | undefined): string | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [ownerB64, exp, sig] = parts;
  const expected = sign(`${ownerB64}.${exp}`);
  try {
    if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch { return null; }
  if (!Number(exp) || Number(exp) < Date.now()) return null;
  try { return Buffer.from(ownerB64, "base64url").toString("utf8"); } catch { return null; }
}
