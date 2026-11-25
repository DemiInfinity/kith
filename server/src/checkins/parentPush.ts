// Notifications to the parent's own devices (separate subscriptions from the child's, same VAPID keys).
// - Reports, at the levels the parent picks: "Right now" is on by default and ignores quiet hours;
//   "Today" and "Just so you know" are off by default.
// - "The weekly summary is ready", and budget alerts (Low power started, the hard stop reached).
// - Lock-screen privacy: by default the notification only says something needs them. Showing the
//   report's one-line summary is an option. The child's chat text is never sent.
// - Anything that isn't urgent waits until quiet hours end, then goes out.

import type { DB } from "../db.js";
import { all, run } from "../db.js";
import { config } from "../config.js";
import { loadParentSettings } from "../settings.js";
import { inQuietHours } from "../budget/time.js";
import { pushReady, sendTo } from "./push.js";
import { recordParentNative } from "./parentInbox.js";

/** Delivers one notification: to the Mac app's inbox (always), and by web push when it's set up. */
async function deliver(db: DB, n: ParentNote, showSummary: boolean, ttl: number, now: number): Promise<number> {
  const p = parentPayload(n, showSummary);
  recordParentNative(db, p, n.kind, n.kind === "report-now", now);
  return pushReady() ? sendTo(db, "parent", p, ttl) : 0;
}

export type ParentKind = "report-now" | "report-today" | "report-fyi" | "weekly" | "budget" | "test";

export interface ParentNote { kind: ParentKind; summary?: string }

/** What actually goes to the device: generic unless the parent chose to show the summary. */
export function parentPayload(n: ParentNote, showSummary: boolean) {
  const generic: Record<ParentKind, string> = {
    "report-now": "Something needs you now. Open Kith to read it.",
    "report-today": "Something to look at today. Open Kith to read it.",
    "report-fyi": "Something just so you know. Open Kith to read it.",
    weekly: "This week's summary is ready.",
    budget: "There's an update about this month's energy.",
    test: "Notifications from Kith reach this device.",
  };
  const isReport = n.kind.startsWith("report-");
  const body = isReport && showSummary && n.summary ? n.summary.replace(/\s+/g, " ").slice(0, 140) : n.kind === "budget" && n.summary ? n.summary : generic[n.kind];
  return { title: n.kind === "report-now" ? "Kith: needs you" : "Kith", body, url: "/parent", tag: `kith-parent-${n.kind}` };
}

function wanted(db: DB, kind: ParentKind): boolean {
  const p = loadParentSettings(db).notify;
  if (kind === "test") return true;
  if (kind === "report-now") return p.now;
  if (kind === "report-today") return p.today;
  if (kind === "report-fyi") return p.fyi;
  if (kind === "weekly") return p.weekly;
  return p.budget;
}

/** Sends now, or holds it until quiet hours end. Returns how many devices got it now. */
export async function notifyParent(db: DB, n: ParentNote, now = Date.now()): Promise<number> {
  if (!wanted(db, n.kind)) return 0;
  const s = loadParentSettings(db);
  if (n.kind !== "report-now" && n.kind !== "test" && inQuietHours(now, config.timezone, s.quietHours)) {
    run(db, "INSERT INTO push_held(ts, kind, json) VALUES (?,?,?)", now, n.kind, JSON.stringify(n));
    return 0;
  }
  return deliver(db, n, s.notify.showSummary, n.kind === "report-now" ? 24 * 3600 : 12 * 3600, now);
}

/** Sends what waited through quiet hours (newest of each kind only, so it isn't a flood). */
export async function flushHeld(db: DB, now = Date.now()): Promise<number> {
  const s = loadParentSettings(db);
  if (inQuietHours(now, config.timezone, s.quietHours)) return 0;
  const rows = all<{ id: number; kind: ParentKind; json: string }>(db, "SELECT id, kind, json FROM push_held ORDER BY ts DESC");
  if (!rows.length) return 0;
  run(db, "DELETE FROM push_held");
  const seen = new Set<string>();
  let sent = 0;
  for (const r of rows) {
    if (seen.has(r.kind) || !wanted(db, r.kind)) continue;
    seen.add(r.kind);
    sent += await deliver(db, JSON.parse(r.json) as ParentNote, s.notify.showSummary, 12 * 3600, now);
  }
  return sent;
}
