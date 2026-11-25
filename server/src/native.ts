// The Mac app (mac/): what its native side needs from the server.
//
// - An inbox of Pip's notifications, so the app can show them as Mac notifications. Web push
//   doesn't reach an app's embedded web view, so pushToChild() also records each one here.
// - Calendar & Reminders the child has chosen to share from her Mac (Kith › Share Calendar &
//   Reminders with Pip). Kept for a day, titles only, redacted like anything she types, and logged
//   for the parent when it's switched on or off.
// - Things Pip has asked to add to her calendar or reminders. The Mac shows her a native
//   "Add / Not now" prompt for each; nothing is added without her yes.
//
// All routes are for the child only. Nothing here works in a normal browser: there's no native
// side to answer, and the routes just sit unused.

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { DB } from "./db.js";
import { all, get, run } from "./db.js";
import type { ToolDef } from "./connections/connections.js";
import { redactPersonal } from "./safety/rules.js";
import { logActivity } from "./desk/activity.js";
import { config } from "./config.js";
import { localParts } from "./budget/time.js";
import { parseLocal } from "./companion/schedules.js";
import { requireRole } from "./auth.js";

const DAY = 86_400_000;
/** A shared calendar older than this isn't used (the Mac sends a fresh one every few minutes). */
const CALENDAR_FRESH = DAY;

const ready = new WeakSet<DB>();
/** Creates the tables on first use (any database, including tests'). */
export function nativeSchema(db: DB) {
  if (ready.has(db)) return;
  ready.add(db);
  db.exec(`
CREATE TABLE IF NOT EXISTS native_inbox (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, body TEXT NOT NULL, url TEXT, kind TEXT NOT NULL, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS native_actions (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created INTEGER NOT NULL, done INTEGER);
CREATE TABLE IF NOT EXISTS native_calendar (id INTEGER PRIMARY KEY CHECK (id = 1), json TEXT NOT NULL, updated INTEGER NOT NULL);
`);
}

// ── Notifications ─────────────────────────────────────────────────────────────────────────

/** Called by pushToChild for everything she has chosen to be notified about. */
export function recordNative(db: DB, payload: { title: string; body: string; url?: string }, kind: string, now = Date.now()) {
  nativeSchema(db);
  run(db, "INSERT INTO native_inbox(title, body, url, kind, created) VALUES (?,?,?,?,?)", payload.title.slice(0, 120), payload.body.slice(0, 400), payload.url ?? null, kind, now);
  run(db, "DELETE FROM native_inbox WHERE created < ?", now - 2 * DAY);
}

/** How many notifications one poll returns; `more` says there are others waiting. */
export const INBOX_PAGE = 10;

export function inboxAfter(db: DB, after: number | null) {
  nativeSchema(db);
  // The first poll only learns where the inbox is up to, so old notifications aren't replayed.
  const newest = get<{ id: number | null }>(db, "SELECT MAX(id) AS id FROM native_inbox")?.id ?? 0;
  // A cursor past the newest id (the database was reset) would wait forever: start again from now.
  if (after === null || after > newest) return { items: [], last: newest, more: false };
  const rows = all<{ id: number; title: string; body: string; url: string | null }>(db, "SELECT id, title, body, url FROM native_inbox WHERE id > ? ORDER BY id LIMIT ?", after, INBOX_PAGE + 1);
  const items = rows.slice(0, INBOX_PAGE);
  // `last` is the last item handed over, never the newest id: anything past this page comes next time.
  return { items, last: items.length ? items[items.length - 1].id : after, more: rows.length > INBOX_PAGE };
}

// ── Shared Calendar & Reminders ─────────────────────────────────────────────────────────────

const Str = (n: number) => z.string().max(1000).transform((s) => redactPersonal(s.slice(0, n)).text);
export const CalendarSnapshot = z.object({
  events: z.array(z.object({ title: Str(200), start: z.number().int(), end: z.number().int(), allDay: z.boolean(), calendar: Str(80) })).max(60),
  reminders: z.array(z.object({ title: Str(200), due: z.number().int().nullable(), list: Str(80) })).max(60),
});
export type CalendarSnapshot = z.infer<typeof CalendarSnapshot>;

/** Validates and redacts (titles can hold phone numbers or addresses), then keeps it. */
export function saveCalendar(db: DB, input: unknown, now = Date.now()) {
  nativeSchema(db);
  const snap = CalendarSnapshot.parse(input);
  const had = Boolean(get(db, "SELECT id FROM native_calendar WHERE id = 1"));
  run(db, "INSERT INTO native_calendar(id, json, updated) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated = excluded.updated", JSON.stringify(snap), now);
  if (!had) logActivity(db, "📅", "Shared their Calendar and Reminders from the Mac app (Pip sees the coming week)");
}

export function clearCalendar(db: DB) {
  nativeSchema(db);
  const had = Boolean(get(db, "SELECT id FROM native_calendar WHERE id = 1"));
  run(db, "DELETE FROM native_calendar");
  run(db, "UPDATE native_actions SET status = 'cancelled', done = ? WHERE status = 'pending'", Date.now());
  if (had) logActivity(db, "📅", "Stopped sharing their Calendar and Reminders");
}

export function sharedCalendar(db: DB, now = Date.now()): CalendarSnapshot | null {
  nativeSchema(db);
  const row = get<{ json: string; updated: number }>(db, "SELECT json, updated FROM native_calendar WHERE id = 1");
  if (!row || now - row.updated > CALENDAR_FRESH) return null;
  return JSON.parse(row.json) as CalendarSnapshot;
}

function fmt(ts: number, tz: string, withTime: boolean) {
  const p = localParts(ts, tz);
  const day = `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][p.weekday]} ${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
  return withTime ? `${day} ${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}` : day;
}

/** For the prompt: the coming week, if she's sharing it. Empty string otherwise. */
export function calendarNote(db: DB, tz = config.timezone, now = Date.now()): string {
  const snap = sharedCalendar(db, now);
  if (!snap) return "";
  const events = snap.events.filter((e) => e.end >= now).slice(0, 30)
    .map((e) => `- ${fmt(e.start, tz, !e.allDay)}${e.allDay ? " (all day)" : `–${fmt(e.end, tz, true).slice(-5)}`}: ${e.title}`);
  const todos = snap.reminders.slice(0, 30).map((r) => `- ${r.title}${r.due ? ` (due ${fmt(r.due, tz, true)})` : ""}`);
  return [
    "They share their Mac's Calendar and Reminders with you. Use it to be helpful (plan revision around it, ask how things went); it can include other people's names, so keep it between you. Only add things when they ask.",
    `Their week:\n${events.join("\n") || "- nothing on"}`,
    `Their to-dos:\n${todos.join("\n") || "- none"}`,
  ].join("\n");
}

// ── Things Pip asks to add ──────────────────────────────────────────────────────────────────

export type NativeAction =
  | { id: number; kind: "event"; title: string; start: number; end: number | null; allDay: boolean }
  | { id: number; kind: "reminder"; title: string; due: number | null };

export function pendingActions(db: DB, now = Date.now()): NativeAction[] {
  nativeSchema(db);
  // Unanswered requests lapse after a day.
  run(db, "UPDATE native_actions SET status = 'expired', done = ? WHERE status = 'pending' AND created < ?", now, now - DAY);
  return all<{ id: number; kind: string; json: string }>(db, "SELECT id, kind, json FROM native_actions WHERE status = 'pending' ORDER BY id")
    .map((r) => ({ id: r.id, kind: r.kind, ...JSON.parse(r.json) }) as NativeAction);
}

export function finishAction(db: DB, id: number, result: "added" | "declined" | "failed") {
  nativeSchema(db);
  run(db, "UPDATE native_actions SET status = ?, done = ? WHERE id = ? AND status = 'pending'", result, Date.now(), id);
}

const LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const LOCAL_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Offered to Pip only while she's sharing her calendar from the Mac app. */
export function nativeTools(db: DB, tz = config.timezone): ToolDef[] {
  if (!sharedCalendar(db)) return [];
  const queue = (kind: "event" | "reminder", data: object) => {
    const waiting = get<{ n: number }>(db, "SELECT COUNT(*) AS n FROM native_actions WHERE status = 'pending'")?.n ?? 0;
    if (waiting >= 5) return "There are already several things waiting for them to say yes to on their Mac. Let them catch up first.";
    run(db, "INSERT INTO native_actions(kind, json, created) VALUES (?,?,?)", kind, JSON.stringify(data), Date.now());
    return "Sent to their Mac. They'll see a prompt asking them to confirm it, so tell them to look out for it (nothing is added until they say yes).";
  };
  const obj = (properties: Record<string, unknown>, required: string[]) => ({ type: "object" as const, additionalProperties: false, properties, required });
  return [
    {
      name: "add_calendar_event",
      description: "Add something to their Mac's calendar, only when they ASK you to (e.g. a revision session or a test date). They confirm it on their Mac first. Use their local time.",
      input_schema: obj({
        title: { type: "string", description: "Short, e.g. 'Revise fractions'" },
        start: { type: "string", description: "Local YYYY-MM-DDTHH:MM, or YYYY-MM-DD for an all-day event" },
        end: { type: "string", description: "Local YYYY-MM-DDTHH:MM, or empty for an hour (all day: empty)" },
      }, ["title", "start", "end"]),
      connection: "companion",
      level: "act",
      run: async (input) => {
        const v = z.object({ title: z.string().min(1).max(200), start: z.string(), end: z.string().optional() }).parse(input);
        const title = redactPersonal(v.title).text;
        if (LOCAL_DAY.test(v.start)) return queue("event", { title, start: parseLocal(`${v.start}T00:00`, tz), end: null, allDay: true });
        if (!LOCAL.test(v.start)) return "Use YYYY-MM-DDTHH:MM or YYYY-MM-DD for the start.";
        const start = parseLocal(v.start, tz);
        const end = v.end && LOCAL.test(v.end) ? parseLocal(v.end, tz) : null;
        if (start < Date.now() - 3_600_000) return "That time has already gone. Check the date with them.";
        return queue("event", { title, start, end: end && end > start ? end : null, allDay: false });
      },
    },
    {
      name: "add_reminder",
      description: "Add a to-do to their Mac's Reminders app, only when they ASK you to. They confirm it on their Mac first. (For a nudge from you in chat, use schedule instead.)",
      input_schema: obj({
        title: { type: "string", description: "Short, e.g. 'Hand in English essay'" },
        due: { type: "string", description: "Local YYYY-MM-DDTHH:MM, or empty for no due date" },
      }, ["title", "due"]),
      connection: "companion",
      level: "act",
      run: async (input) => {
        const v = z.object({ title: z.string().min(1).max(200), due: z.string().optional() }).parse(input);
        return queue("reminder", { title: redactPersonal(v.title).text, due: v.due && LOCAL.test(v.due) ? parseLocal(v.due, tz) : null });
      },
    },
  ];
}

// ── Routes ─────────────────────────────────────────────────────────────────────────────────

export function registerNative(app: FastifyInstance, db: DB) {
  nativeSchema(db);
  const child = requireRole("child");
  const limit = { rateLimit: { max: 30, timeWindow: "1 minute" } };

  app.get("/api/native/inbox", { preHandler: child, config: limit }, async (req) => {
    const a = (req.query as { after?: string }).after;
    return inboxAfter(db, a !== undefined && /^\d+$/.test(a) ? Number(a) : null);
  });

  app.put("/api/native/calendar", { preHandler: child, config: limit, bodyLimit: 128 * 1024 }, async (req) => {
    saveCalendar(db, req.body);
    return { ok: true };
  });

  app.delete("/api/native/calendar", { preHandler: child, config: limit }, async () => {
    clearCalendar(db);
    return { ok: true };
  });

  app.get("/api/native/actions", { preHandler: child, config: limit }, async () => ({ actions: pendingActions(db) }));

  app.post("/api/native/actions/:id", { preHandler: child, config: limit }, async (req) => {
    const id = Number((req.params as { id: string }).id);
    const { result } = z.object({ result: z.enum(["added", "declined", "failed"]) }).parse(req.body);
    finishAction(db, id, result);
    return { ok: true };
  });
}
