// Asking for a new language. The child asks ("I want to learn French", by chatting or with "Add a
// language"); it waits for the grown-up, who gets a notification and approves or declines in the
// parent view. Nothing is practised until it's approved. A language that isn't on Kith's list gets
// a gentle "let's ask your grown-up" and is flagged to the parent, who can add it.

import type { DB } from "../db.js";
import { get, run } from "../db.js";
import { childName } from "../auth.js";
import { notifyParent } from "../checkins/parentPush.js";
import { redactPersonal } from "../safety/rules.js";
import { requestLanguage, type LangProfile } from "./languages.js";

export interface Unlisted { name: string; ts: number }

export function unlistedAsks(db: DB): Unlisted[] {
  const r = get<{ json: string }>(db, "SELECT json FROM settings WHERE key = 'languages_unlisted'");
  return r ? (JSON.parse(r.json) as Unlisted[]) : [];
}
function saveUnlisted(db: DB, list: Unlisted[]) {
  run(db, "INSERT INTO settings(key, json) VALUES('languages_unlisted', ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json", JSON.stringify(list.slice(-10)));
}
export function dismissUnlisted(db: DB, name: string) {
  saveUnlisted(db, unlistedAsks(db).filter((u) => u.name.toLowerCase() !== name.toLowerCase()));
}

export type AskResult =
  | { status: "pending" | "active"; code: string; name: string; message: string }
  | { status: "unsupported"; name: string; message: string };

/** What the child (or the companion's tool) calls. Tells the parent, and says kindly what happens next. */
export async function askForLanguage(db: DB, query: string, profile: Partial<LangProfile> = {}, now = Date.now()): Promise<AskResult> {
  const kid = childName(db) || "Your child";
  const r = requestLanguage(db, query, profile, now);
  if (!r.ok) {
    const name = redactPersonal(r.name).text.replace(/[^\p{L}\p{M} '-]/gu, "").trim().slice(0, 40) || "a language";
    if (!unlistedAsks(db).some((u) => u.name.toLowerCase() === name.toLowerCase())) {
      saveUnlisted(db, [...unlistedAsks(db), { name, ts: now }]);
      await notifyParent(db, { kind: "language", summary: `${kid} would like to learn ${name}, which isn't on Kith's list yet. You can add it in the parent view.` }, now);
    }
    return { status: "unsupported", name, message: `${name} isn't one I can teach yet, so let's ask your grown-up. I've let them know you'd like to learn it.` };
  }
  if (r.status === "active") return { status: "active", code: r.info.code, name: r.info.name, message: `You're already learning ${r.info.name}! It's on your Languages page.` };
  // Only tell the parent once per request.
  if (profile && r.info && requestFresh(db, r.info.code, now)) {
    await notifyParent(db, { kind: "language", summary: `${kid} would like to learn ${r.info.name}.` }, now);
  }
  return { status: "pending", code: r.info.code, name: r.info.name, message: `I've asked your grown-up about ${r.info.name}. It'll be on your Languages page as soon as they say yes.` };
}

/** True the first time a pending request is seen at this timestamp (so a repeat ask doesn't re-notify). */
function requestFresh(db: DB, code: string, now: number): boolean {
  const r = get<{ json: string }>(db, "SELECT json FROM settings WHERE key = 'languages'");
  const p = r ? (JSON.parse(r.json) as Record<string, { requested?: number }>)[code] : undefined;
  return p?.requested === now;
}
