// "What Pip did today": a plain, timestamped log of the desk's work that the child and the parent
// both see. Kept for the same time as chats.

import type { DB } from "../db.js";
import { all, run } from "../db.js";
import { redactPersonal } from "../safety/rules.js";

export function logActivity(db: DB, icon: string, text: string) {
  run(db, "INSERT INTO desk_activity(ts, icon, text) VALUES (?,?,?)", Date.now(), icon.slice(0, 8), redactPersonal(text).text.slice(0, 200));
}

export function activitySince(db: DB, since: number) {
  return all<{ id: number; ts: number; icon: string; text: string }>(db, "SELECT * FROM desk_activity WHERE ts >= ? ORDER BY ts DESC LIMIT 200", since);
}
