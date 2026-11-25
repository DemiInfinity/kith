import webpush from "web-push";
import type { DB } from "../db.js";
import { all, get, run } from "../db.js";
import { config } from "../config.js";
import { loadProfile } from "../settings.js";
import { recordNative } from "../native.js";

export const pushReady = () => Boolean(config.push.publicKey && config.push.privateKey);

if (pushReady()) webpush.setVapidDetails(config.push.subject, config.push.publicKey, config.push.privateKey);

export type Audience = "child" | "parent";

// Web push only ever goes to the browsers' own push services. Kith posts to whatever endpoint is
// saved, so anything else would let a signed-in device make the server call any address it likes.
const PUSH_HOSTS = [
  { exact: "web.push.apple.com" }, { suffix: ".push.apple.com" },                       // Safari (Mac, iPhone)
  { exact: "fcm.googleapis.com" }, { exact: "android.googleapis.com" },                  // Chrome, Android
  { exact: "updates.push.services.mozilla.com" }, { suffix: ".push.services.mozilla.com" }, // Firefox
  { suffix: ".notify.windows.com" },                                                    // Edge (Windows)
];

/** Whether an endpoint is on a known browser push service (https, default port). */
export function isPushEndpoint(endpoint: string): boolean {
  let u: URL;
  try { u = new URL(endpoint); } catch { return false; }
  if (u.protocol !== "https:" || u.port !== "" || u.username || u.password) return false;
  const host = u.hostname.toLowerCase();
  return PUSH_HOSTS.some((h) => ("exact" in h ? host === h.exact : host.endsWith(h.suffix!) && host.length > h.suffix!.length));
}

export function saveSubscription(db: DB, sub: { endpoint: string; keys: { p256dh: string; auth: string } }, audience: Audience = "child") {
  if (!isPushEndpoint(sub.endpoint)) throw new Error("bad endpoint");
  run(db, "INSERT INTO push_subs(endpoint, json, created, audience) VALUES (?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET json = excluded.json, audience = excluded.audience",
    sub.endpoint, JSON.stringify(sub), Date.now(), audience);
}

export function deviceCount(db: DB, audience: Audience): number {
  return get<{ n: number }>(db, "SELECT COUNT(*) AS n FROM push_subs WHERE audience = ?", audience)?.n ?? 0;
}

/** Sends to one audience's devices. Returns how many got it. */
export async function sendTo(db: DB, audience: Audience, payload: Record<string, unknown>, ttl = 3600): Promise<number> {
  if (!pushReady()) return 0;
  let sent = 0;
  for (const row of all<{ endpoint: string; json: string }>(db, "SELECT endpoint, json FROM push_subs WHERE audience = ?", audience)) {
    try {
      await sender.send(JSON.parse(row.json), JSON.stringify(payload), { TTL: ttl, timeout: 15_000 });
      sent++;
    } catch (err) {
      const code = (err as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) removeSubscription(db, row.endpoint);
      else console.warn("[push] failed", code);
    }
  }
  return sent;
}

/** The web-push call, swappable in tests. */
export const sender = { send: (sub: webpush.PushSubscription, body: string, opts: webpush.RequestOptions) => webpush.sendNotification(sub, body, opts) };

export function removeSubscription(db: DB, endpoint: string) {
  run(db, "DELETE FROM push_subs WHERE endpoint = ?", endpoint);
}

export type PushKind = "checkins" | "reminders" | "deskReady" | "test";

/** Sends to the child's devices, if they want this kind. Returns how many got it. */
export async function pushToChild(db: DB, payload: { title: string; body: string; url?: string }, kind: PushKind = "checkins"): Promise<number> {
  if (kind !== "test" && !loadProfile(db).notifications[kind]) return 0;
  // The Mac app shows these as Mac notifications (web push can't reach its web view).
  recordNative(db, payload, kind);
  if (!pushReady()) return 0;
  return sendTo(db, "child", { ...payload, tag: `kith-${kind}` });
}
