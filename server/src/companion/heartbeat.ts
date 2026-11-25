// The heartbeat: every 30 minutes, always (it can't be paused, switched off or deleted), the companion
// quietly looks
// over what's coming up (reminders, exams, things it made, what they said was happening) against a
// short checklist the parent can edit, and decides whether anything needs doing. Usually nothing
// does. When something does, it's one of:
//   - a gentle check-in message (same rules as other check-ins: never in quiet hours, at most the
//     parent's daily limit, never while they're chatting, never guilt-tripping, safety-checked),
//   - a line in its journal (on its desk, which the child and parent can both read).
// It runs on Low power from the desk's budget, and skips asking Claude at all when nothing has
// changed since the last beat. In quiet hours it still beats, but only notes that it's asleep.

import crypto from "node:crypto";
import type { DB } from "../db.js";
import { all, get, run } from "../db.js";
import { config } from "../config.js";
import { loadParentSettings, loadProfile } from "../settings.js";
import { inQuietHours, localDate, localParts, startOfDay } from "../budget/time.js";
import { callJson, type LLM } from "../llm.js";
import { listMemories } from "./memory.js";
import { listSchedules } from "./schedules.js";
import { countdowns, listSubjects } from "../study/study.js";
import { isGuiltTrip } from "../safety/rules.js";
import type { SafetyChecker } from "../safety/check.js";
import { pushToChild } from "../checkins/push.js";
import { logActivity } from "../desk/activity.js";

const MIN = 60_000;
export const EVERY_MINUTES = 30;

export interface Beat { id: number; ts: number; outcome: string; note: string; sig: string }

export function lastBeat(db: DB): Beat | null {
  return get<Beat>(db, "SELECT * FROM heartbeats ORDER BY ts DESC LIMIT 1") ?? null;
}
export function recentBeats(db: DB, n = 8): Beat[] {
  return all<Beat>(db, "SELECT * FROM heartbeats ORDER BY ts DESC LIMIT ?", n);
}
function record(db: DB, ts: number, outcome: string, note = "", sig = "") {
  run(db, "INSERT INTO heartbeats(ts, outcome, note, sig) VALUES (?,?,?,?)", ts, outcome, note.slice(0, 300), sig);
  run(db, "DELETE FROM heartbeats WHERE ts < ?", ts - 14 * 24 * 60 * MIN);
}

/** What the companion looks at on each beat (no chat text: just what's coming up). */
export function gather(db: DB, now: number) {
  const tz = config.timezone;
  const today = localDate(now, tz);
  const reminders = listSchedules(db).filter((s) => s.active && s.at > now && s.at < now + 24 * 60 * MIN).map((s) => ({ title: s.title, kind: s.kind, inMinutes: Math.round((s.at - now) / MIN) }));
  const exams = countdowns(listSubjects(db), today).filter((c) => c.days <= 14).map((c) => ({ subject: c.subject, kind: c.kind, days: c.days }));
  const made = all<{ title: string; status: string }>(db, "SELECT title, status FROM desk_jobs WHERE ts > ? ORDER BY ts DESC LIMIT 5", now - 24 * 60 * MIN);
  const memories = listMemories(db).slice(0, 8).map((m) => m.text);
  const lastChild = get<{ ts: number }>(db, "SELECT MAX(ts) AS ts FROM messages WHERE role = 'child'")?.ts ?? null;
  const checkinsToday = get<{ n: number }>(db, "SELECT COUNT(*) AS n FROM checkins WHERE ts >= ?", startOfDay(now, tz))?.n ?? 0;
  return { reminders, exams, made, memories, lastChildMinutesAgo: lastChild ? Math.round((now - lastChild) / MIN) : null, checkinsToday };
}

export type Decision = { action: "nothing" | "checkin" | "journal"; message: string; why: string };
const SCHEMA = {
  type: "object", additionalProperties: false, required: ["action", "message", "why"],
  properties: {
    action: { type: "string", enum: ["nothing", "checkin", "journal"] },
    message: { type: "string", description: "For checkin: the message to them (under 25 words). For journal: one sentence for your journal. Otherwise empty." },
    why: { type: "string", description: "A few words on why (shown to them and their grown-up), e.g. 'all quiet' or 'maths mock on Friday'." },
  },
};

export interface HeartbeatDeps { db: DB; llm: LLM; safety: SafetyChecker; deskCanWork: () => boolean }

/** One beat, if it's due. Returns what happened (or null when it wasn't time). */
export async function heartbeat(deps: HeartbeatDeps, now = Date.now()): Promise<string | null> {
  const { db, llm } = deps;
  const settings = loadParentSettings(db);
  const profile = loadProfile(db);
  const hb = settings.heartbeat;
  if (!profile.setupDone) return null;
  const last = lastBeat(db);
  if (last && now - last.ts < EVERY_MINUTES * MIN - 30_000) return null;
  if (inQuietHours(now, config.timezone, settings.quietHours)) { record(db, now, "asleep", "quiet hours"); return "asleep"; }
  if (!llm.available) { record(db, now, "resting", "no API key yet"); return "resting"; }
  if (!deps.deskCanWork()) { record(db, now, "resting", "the desk is out of energy today"); return "resting"; }

  const state = gather(db, now);
  // Nothing new since the last beat (and that wasn't long ago): no need to ask Claude.
  const sig = crypto.createHash("sha256").update(JSON.stringify({ ...state, lastChildMinutesAgo: state.lastChildMinutesAgo === null ? null : Math.min(state.lastChildMinutesAgo, 600) > 180 ? "long" : "recent" })).digest("hex").slice(0, 16);
  if (last && last.sig === sig && now - last.ts < 3 * 60 * MIN) { record(db, now, "quiet", "nothing new", sig); return "quiet"; }

  const p = localParts(now, config.timezone);
  let d: Decision;
  try {
    d = await callJson<Decision>(llm, {
      bucket: "desk", kind: "heartbeat",
      params: {
        model: config.anthropic.lowModel, max_tokens: 400, output_config: { effort: "low" },
        system: `You are ${profile.name}, a friendly AI companion for a teenager, doing a quiet heartbeat check (nobody is talking to you). Look at what's coming up and the checklist, and decide if anything needs doing. Usually the answer is "nothing". Only "checkin" if a short, kind message would genuinely help right now (no guilt, no "I miss you", no pressure, never just to chat; ${state.checkinsToday >= settings.maxCheckinsPerDay ? "you've already used today's check-ins, so not a checkin" : `at most ${settings.maxCheckinsPerDay} check-ins a day, ${state.checkinsToday} used`}${state.lastChildMinutesAgo !== null && state.lastChildMinutesAgo < 60 ? "; they're chatting with you right now, so not a checkin" : ""}). "journal" for a one-line note to yourself when something's worth remembering on your desk (cheerful, topic-level, nothing private).\n\nChecklist from their grown-up:\n${hb.checklist}`,
        messages: [{ role: "user", content: `Now: ${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][p.weekday]} ${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}\n${JSON.stringify(state)}` }],
      } as never,
      schema: SCHEMA,
      parse: (v) => v as Decision,
    });
  } catch (err) {
    record(db, now, "error", (err as Error).message.slice(0, 120), sig);
    return "error";
  }

  if (d.action === "checkin" && d.message.trim()) {
    const ok = state.checkinsToday < settings.maxCheckinsPerDay && !(state.lastChildMinutesAgo !== null && state.lastChildMinutesAgo < 60)
      && !isGuiltTrip(d.message) && (await deps.safety.checkOutput(d.message, "")).ok;
    if (!ok) { record(db, now, "quiet", `held back a check-in (${d.why})`, sig); return "quiet"; }
    const text = d.message.trim().slice(0, 300);
    const delivered = await pushToChild(db, { title: profile.name, body: text, url: "/" }, "checkins");
    run(db, "INSERT INTO checkins(ts, kind, text, delivered) VALUES (?,?,?,?)", now, "heartbeat", text, delivered);
    run(db, "INSERT INTO messages(ts, role, text, mode, meta) VALUES (?, 'companion', ?, 'chat', ?)", now, text, JSON.stringify({ checkin: "heartbeat" }));
    record(db, now, "checked in", d.why, sig);
    return "checked in";
  }
  if (d.action === "journal" && d.message.trim() && (await deps.safety.checkOutput(d.message, "")).ok) {
    const day = localDate(now, config.timezone);
    const prev = get<{ text: string }>(db, "SELECT text FROM journal WHERE day = ?", day)?.text;
    run(db, "INSERT INTO journal(day, text, created) VALUES (?,?,?) ON CONFLICT(day) DO UPDATE SET text = excluded.text", day, (prev ? `${prev} ${d.message.trim()}` : d.message.trim()).slice(0, 800), now);
    logActivity(db, "📔", "Noted something in its journal");
    record(db, now, "journal", d.why, sig);
    return "journal";
  }
  record(db, now, "quiet", d.why || "all quiet", sig);
  return "quiet";
}

/** For the Scheduled tab and the parent view. */
export function heartbeatStatus(db: DB, now = Date.now()) {
  const hb = loadParentSettings(db).heartbeat;
  const last = lastBeat(db);
  return {
    everyMinutes: EVERY_MINUTES, checklist: hb.checklist,
    last: last ? { ts: last.ts, outcome: last.outcome, note: last.note } : null,
    next: Math.max(now, (last?.ts ?? now) + EVERY_MINUTES * MIN),
    recent: recentBeats(db).map((b) => ({ ts: b.ts, outcome: b.outcome, note: b.note })),
  };
}
