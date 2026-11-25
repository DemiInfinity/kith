// The parent's notifications for the Mac app (web push can't reach its web view). Every parent
// notification is recorded here after the rules are applied (chosen levels, quiet hours, and the
// private lock-screen wording unless summaries are on), with exactly the title and body a web push
// would carry: never the child's chat text. Kept for 2 days. The Mac app polls
// GET /api/native/parent-inbox?after=<id> with the parent's session.

import type { FastifyInstance } from "fastify";
import type { DB } from "../db.js";
import { all, get, run } from "../db.js";
import { requireRole } from "../auth.js";

const DAY = 86_400_000;

function schema(db: DB) {
  db.exec(`CREATE TABLE IF NOT EXISTS native_parent_inbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, body TEXT NOT NULL, url TEXT,
    kind TEXT NOT NULL, urgent INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL
  )`);
}

export function recordParentNative(db: DB, p: { title: string; body: string; url?: string }, kind: string, urgent: boolean, now = Date.now()) {
  schema(db);
  run(db, "INSERT INTO native_parent_inbox(title, body, url, kind, urgent, created) VALUES (?,?,?,?,?,?)",
    p.title.slice(0, 120), p.body.slice(0, 400), p.url ?? null, kind, urgent ? 1 : 0, now);
  run(db, "DELETE FROM native_parent_inbox WHERE created < ?", now - 2 * DAY);
}

/** Like the child's inbox: the first poll (no `after`) only learns where it's up to. */
export function parentInboxAfter(db: DB, after: number | null) {
  schema(db);
  const last = get<{ id: number | null }>(db, "SELECT MAX(id) AS id FROM native_parent_inbox")?.id ?? 0;
  if (after === null) return { items: [], last };
  const items = all<{ id: number; title: string; body: string; url: string | null; kind: string; urgent: number }>(db,
    "SELECT id, title, body, url, kind, urgent FROM native_parent_inbox WHERE id > ? ORDER BY id LIMIT 10", after)
    .map((r) => ({ ...r, urgent: r.urgent === 1 }));
  return { items, last: Math.max(last, after) };
}

/** When Kith Parent on a Mac last checked in: it counts as one of the parent's devices. */
export function macAppSeen(db: DB): number | null {
  const r = get<{ json: string }>(db, "SELECT json FROM settings WHERE key = 'parent_mac_seen'");
  return r ? Number(JSON.parse(r.json)) || null : null;
}
/** Kith Parent polls about once a minute while it runs; give it some slack for a sleeping Mac. */
export const macAppConnected = (db: DB, now = Date.now()) => { const t = macAppSeen(db); return !!t && now - t < 30 * 60_000; };

export function registerParentInbox(app: FastifyInstance, db: DB) {
  const parent = requireRole("parent");
  app.get("/api/native/parent-inbox", { preHandler: parent, config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req) => {
    run(db, "INSERT INTO settings(key, json) VALUES('parent_mac_seen', ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json", JSON.stringify(Date.now()));
    const a = (req.query as { after?: string }).after;
    return parentInboxAfter(db, a !== undefined && /^\d+$/.test(a) ? Number(a) : null);
  });
}
