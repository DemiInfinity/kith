// Gentle check-ins. The companion never calls; it can send a short note, at most twice a day
// (the parent can set fewer), never in quiet hours, never with guilt ("I missed you!"), and only
// the kinds the child switched on. Pure, so the rules are easy to test.

import { inQuietHours, localDate, localParts } from "../budget/time.js";

export type CheckinKind = "how_did_it_go" | "morning_hello" | "water";

export interface CheckinState {
  now: number;
  tz: string;
  quietHours: { start: string; end: string };
  maxPerDay: number;
  sentTimes: number[];                 // when earlier check-ins went out (any day)
  lastChildMessageAt: number | null;
  toggles: { askHowThingsWent: boolean; morningHello: boolean; waterWhileRevising: boolean };
  memories: { id: number; text: string; icon: string; about_date: string | null; asked: number }[];
  recentChildMessageTimes: number[];   // child messages in the last hour, for "revising"
}

export interface CheckinPlan { kind: CheckinKind; memoryId?: number; memoryText?: string; icon?: string }

const MIN = 60_000;
const HOUR = 60 * MIN;
export const HARD_MAX_PER_DAY = 2;
export const MIN_GAP = 3 * HOUR;

export function planCheckin(s: CheckinState): CheckinPlan | null {
  if (inQuietHours(s.now, s.tz, s.quietHours)) return null;
  const today = localDate(s.now, s.tz);
  const sentToday = s.sentTimes.filter((t) => localDate(t, s.tz) === today).length;
  if (sentToday >= Math.min(HARD_MAX_PER_DAY, s.maxPerDay)) return null;
  const last = Math.max(0, ...s.sentTimes);
  const p = localParts(s.now, s.tz);
  const minutes = p.hour * 60 + p.minute;

  // Water while revising: they've been at it for 40+ minutes and are still here.
  if (s.toggles.waterWhileRevising && s.now - last > 2 * HOUR) {
    const times = s.recentChildMessageTimes.filter((t) => s.now - t < 60 * MIN).sort((a, b) => a - b);
    if (times.length >= 4 && s.now - times[0] >= 40 * MIN && s.now - times[times.length - 1] < 10 * MIN) return { kind: "water" };
  }

  if (s.now - last < MIN_GAP) return null;
  // Don't interrupt while they're mid-conversation.
  if (s.lastChildMessageAt && s.now - s.lastChildMessageAt < 20 * MIN) return null;

  if (s.toggles.morningHello && p.weekday >= 1 && p.weekday <= 5 && minutes >= 7 * 60 + 30 && minutes <= 8 * 60 + 15) {
    return { kind: "morning_hello" };
  }

  if (s.toggles.askHowThingsWent && minutes >= 16 * 60) {
    const yesterday = localDate(s.now - 24 * HOUR, s.tz);
    const m = s.memories.find((x) => !x.asked && x.about_date && (x.about_date === today || x.about_date === yesterday));
    if (m) return { kind: "how_did_it_go", memoryId: m.id, memoryText: m.text, icon: m.icon };
  }
  return null;
}

const MORNING = [
  "Morning! Hope today's a good one. ☀️",
  "Morning! Go get 'em today. 🌤️",
  "Good morning! Have a good day at school. 🎒",
];

export function templateText(plan: CheckinPlan, dayIndex: number): string {
  if (plan.kind === "water") return "Quick one: have a sip of water 💧 Brains revise better hydrated.";
  if (plan.kind === "morning_hello") return MORNING[dayIndex % MORNING.length];
  return `How did it go? ${plan.icon ?? "🙂"} No rush, tell me whenever.`;
}
