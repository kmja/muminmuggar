import webpush from "web-push";
import { query } from "./db";

let configured = false;

function ensureConfigured(): boolean {
  if (configured) return true;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:admin@example.com";
  if (!pub || !priv) return false;
  webpush.setVapidDetails(subject, pub, priv);
  configured = true;
  return true;
}

export function pushConfigured(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
}

/** Send a payload to every stored subscription; prune dead ones (404/410). */
export async function sendToAll(payload: PushPayload): Promise<number> {
  if (!ensureConfigured()) return 0;
  const { rows } = await query<{ id: number; endpoint: string; p256dh: string; auth: string }>(
    "SELECT id, endpoint, p256dh, auth FROM push_subscriptions",
  );
  let sent = 0;
  await Promise.all(
    rows.map(async (r) => {
      const sub = { endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } };
      try {
        await webpush.sendNotification(sub, JSON.stringify(payload));
        sent++;
      } catch (e: unknown) {
        const status = (e as { statusCode?: number })?.statusCode;
        if (status === 404 || status === 410) {
          await query("DELETE FROM push_subscriptions WHERE id = $1", [r.id]);
        } else {
          console.error("push error:", status, e);
        }
      }
    }),
  );
  return sent;
}
