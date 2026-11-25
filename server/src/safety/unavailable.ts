// When the safety check can't run, the child's message is held (not answered), and the parent gets a
// quiet "fyi" so they know Kith was having trouble. It says nothing about what the message was: the
// parent never sees everyday chats. At most one note an hour, so an outage isn't a flood.

import type { DB } from "../db.js";
import { get, run } from "../db.js";
import { config } from "../config.js";
import { createReport, deliverReport, makeReporters, type Reporter } from "../reporting/reporter.js";

const KEY = "safety_unavailable_noted";
const EVERY_MS = 60 * 60_000;

export const UNAVAILABLE_TEXT =
  "Kith's safety check couldn't run for a moment, so it held back a message instead of answering it. Nothing was flagged; this is only so you know. If it keeps happening, check the API key and the server.";

/** Queues the fyi note (if none in the last hour). Returns whether one was made. */
export function noteSafetyUnavailable(
  db: DB,
  ctx: { companionName: string; childName: string },
  reporters?: Reporter[],
  now = Date.now(),
): boolean {
  const last = get<{ json: string }>(db, "SELECT json FROM settings WHERE key = ?", KEY);
  if (last && now - Number(JSON.parse(last.json)) < EVERY_MS) return false;
  run(db, "INSERT INTO settings(key, json) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json", KEY, JSON.stringify(now));
  const report = createReport(db, {
    level: "fyi", category: "safety_unavailable",
    childNotice: "My safety check couldn't run for a moment, so I didn't answer one message.",
    parentText: UNAVAILABLE_TEXT,
  });
  const list = reporters ?? makeReporters(config.reporting.reporters, db);
  setImmediate(() => void deliverReport(db, list, report, ctx).catch(() => undefined));
  return true;
}
