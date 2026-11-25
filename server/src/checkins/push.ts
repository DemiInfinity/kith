import webpush from "web-push";
import type { DB } from "../db.js";
import { all, run } from "../db.js";
import { config } from "../config.js";

export const pushReady = () => Boolean(config.push.publicKey && config.push.privateKey);

if (pushReady()) webpush.setVapidDetails(config.push.subject, config.push.publicKey, config.push.privateKey);

export function saveSubscription(db: DB, sub: { endpoint: string; keys: { p256dh: string; auth: string } }) {
  if (!/^https:\/\//.test(sub.endpoint)) throw new Error("bad endpoint");
  run(db, "INSERT INTO push_subs(endpoint, json, created) VALUES (?,?,?) ON CONFLICT(endpoint) DO UPDATE SET json = excluded.json", sub.endpoint, JSON.stringify(sub), Date.now());
}

export function removeSubscription(db: DB, endpoint: string) {
  run(db, "DELETE FROM push_subs WHERE endpoint = ?", endpoint);
}

/** Sends to the child's devices. Returns how many got it. */
export async function pushToChild(db: DB, payload: { title: string; body: string; url?: string }): Promise<number> {
  if (!pushReady()) return 0;
  let sent = 0;
  for (const row of all<{ endpoint: string; json: string }>(db, "SELECT endpoint, json FROM push_subs")) {
    try {
      await webpush.sendNotification(JSON.parse(row.json), JSON.stringify(payload), { TTL: 3600 });
      sent++;
    } catch (err) {
      const code = (err as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) removeSubscription(db, row.endpoint);
      else console.warn("[push] failed", code);
    }
  }
  return sent;
}
