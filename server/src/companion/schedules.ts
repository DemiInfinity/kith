// Things the child asked the companion to schedule: reminders ("remind me at 7 to revise"), and
// things to make ("every Sunday, make me a quiz on this week's topics"). They show on the
// companion's profile under Scheduled, where the child can pause or delete them.
// Reminders never arrive in quiet hours (they wait until quiet hours end).

import { z } from "zod";
import type { DB } from "../db.js";
import { all, get, run } from "../db.js";
import { inQuietHours, localParts, zonedTime } from "../budget/time.js";

export const Repeat = z.enum(["none", "daily", "weekdays", "weekly"]);
export type Repeat = z.infer<typeof Repeat>;

export const ScheduleInput = z.object({
  title: z.string().trim().min(1).max(120),
  kind: z.enum(["reminder", "make"]).default("reminder"),
  // Local date and time, "YYYY-MM-DDTHH:MM", in the family's time zone.
  when: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
  repeat: Repeat.default("none"),
  // For kind "make": what to make on the desk.
  make: z.object({ kind: z.string().max(30), brief: z.string().max(1000), lookUp: z.string().max(120).optional() }).optional(),
});
export type ScheduleInput = z.infer<typeof ScheduleInput>;

export interface Schedule {
  id: number; created: number; title: string; kind: "reminder" | "make"; payload: string;
  at: number; repeat: Repeat; time: string; active: number; last_run: number | null;
}

export const MAX_ACTIVE = 20;

export function parseLocal(when: string, tz: string): number {
  const [d, t] = when.split("T");
  const [y, m, day] = d.split("-").map(Number);
  const [h, min] = t.split(":").map(Number);
  return zonedTime(y, m, day, h, min, tz);
}

/**
 * The next time after `prev` for a repeating schedule, at the local `time` it was set for ("HH:MM").
 * The stored time is used, not `prev`'s clock time, so a run moved by a clock change (01:30 doesn't
 * exist on the day the clocks go forward) goes back to 01:30 the next day. Pure.
 */
export function nextRun(prev: number, repeat: Repeat, tz: string, time?: string): number | null {
  if (repeat === "none") return null;
  const p = localParts(prev, tz);
  const [hour, minute] = time && /^\d{2}:\d{2}$/.test(time) ? time.split(":").map(Number) : [p.hour, p.minute];
  for (let add = 1; add <= 7; add++) {
    const d = new Date(Date.UTC(p.year, p.month - 1, p.day + add));
    const ts = zonedTime(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), hour, minute, tz);
    const wd = localParts(ts, tz).weekday;
    if (repeat === "daily") return ts;
    if (repeat === "weekdays" && wd >= 1 && wd <= 5) return ts;
    if (repeat === "weekly" && add === 7) return ts;
  }
  return null;
}

/** Why a schedule can't be added (bad time, too many, past), or null. Saves nothing. */
export function scheduleProblem(db: DB, input: unknown, tz: string, now = Date.now()): string | null {
  const r = addSchedule(db, input, tz, now, true);
  return r.ok ? null : r.error;
}

export function addSchedule(db: DB, input: unknown, tz: string, now = Date.now(), dryRun = false): { ok: true; schedule: Schedule } | { ok: false; error: string } {
  const v = ScheduleInput.safeParse(input);
  if (!v.success) return { ok: false, error: "That doesn't look like a time I understand." };
  const s = v.data;
  const active = get<{ n: number }>(db, "SELECT COUNT(*) AS n FROM schedules WHERE active = 1")?.n ?? 0;
  if (active >= MAX_ACTIVE) return { ok: false, error: `There are already ${MAX_ACTIVE} things scheduled. Delete some first.` };
  let at = parseLocal(s.when, tz);
  if (at <= now) {
    if (s.repeat === "none") return { ok: false, error: "That time has already passed." };
    while (at <= now) at = nextRun(at, s.repeat, tz, s.when.slice(11)) ?? Infinity;
  }
  if (s.kind === "make" && !s.make) return { ok: false, error: "What should I make?" };
  if (dryRun) return { ok: true, schedule: { id: 0, created: now, title: s.title, kind: s.kind, payload: "{}", at, repeat: s.repeat, time: s.when.slice(11), active: 1, last_run: null } };
  const res = run(db, "INSERT INTO schedules(created, title, kind, payload, at, repeat, time, active) VALUES (?,?,?,?,?,?,?,1)",
    now, s.title, s.kind, JSON.stringify(s.make ?? {}), at, s.repeat, s.when.slice(11));
  return { ok: true, schedule: get<Schedule>(db, "SELECT * FROM schedules WHERE id = ?", Number(res.lastInsertRowid))! };
}

export function listSchedules(db: DB): Schedule[] {
  return all<Schedule>(db, "SELECT * FROM schedules ORDER BY active DESC, at");
}
export function setActive(db: DB, id: number, active: boolean) {
  run(db, "UPDATE schedules SET active = ? WHERE id = ?", active ? 1 : 0, id);
}
export function deleteSchedule(db: DB, id: number) {
  run(db, "DELETE FROM schedules WHERE id = ?", id);
}

/**
 * Works out which schedules are due. Reminders that fall in quiet hours wait (they're returned
 * once quiet hours end). Pure apart from reading the list. Returns what to run now.
 */
export function dueSchedules(list: Schedule[], now: number, tz: string, quiet: { start: string; end: string }): Schedule[] {
  return list.filter((s) => s.active && s.at <= now && !(s.kind === "reminder" && inQuietHours(now, tz, quiet)));
}

/** After running: move a repeating schedule on, or switch a one-off off. */
export function markRan(db: DB, s: Schedule, now: number, tz: string) {
  let next = nextRun(s.at, s.repeat, tz, s.time);
  while (next !== null && next <= now) next = nextRun(next, s.repeat, tz, s.time);
  if (next === null) run(db, "UPDATE schedules SET active = 0, last_run = ? WHERE id = ?", now, s.id);
  else run(db, "UPDATE schedules SET at = ?, last_run = ? WHERE id = ?", next, now, s.id);
}
