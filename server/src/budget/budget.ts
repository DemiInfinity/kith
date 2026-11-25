import type { DB } from "../db.js";
import { all, get, run } from "../db.js";
import type { Budgets } from "../settings.js";
import { costUsd, type UsageLike } from "./pricing.js";
import { localParts, nextWeekStart, startOfDay, startOfMonth, startOfWeek, zonedTime } from "./time.js";

export type Bucket = "chat" | "desk";
export type SpendKind =
  | "chat" | "talk" | "safety" | "memory" | "summary" | "journal" | "checkin" | "artifact" | "oc" | "study" | "story" | "art" | "browse";
export interface SpendRow { ts: number; usd: number; bucket: Bucket }

/** "full" uses the bigger model, "low" the small one, "resting" means no model calls (only at the hard stop). */
export type PowerMode = "full" | "low" | "resting";

export interface Energy {
  mode: PowerMode;
  /** 0–100, what the child sees. */
  percent: number;
  /** When Full power comes back (if it's not on now). */
  fullBackAt: number | null;
  limitedBy: "week" | "window" | "month" | null;
  weekResetsAt: number;
  // Money, for the parent view.
  usd: { week: number; window: number; month: number; deskWeek: number; windowAllowance: number; chatWeekBudget: number };
}

export interface DeskEnergy {
  canWork: boolean;
  mode: "full" | "low";
  /** Today's slice left, 0–100 (unused days earlier in the week roll forward). */
  percent: number;
  usd: { today: number; week: number; allowanceLeft: number; dailySlice: number };
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const sum = (rows: SpendRow[]) => rows.reduce((t, r) => t + r.usd, 0);

export function splits(b: Budgets) {
  const share = clamp(b.deskSharePercent, 0, 100) / 100;
  return { chatWeek: b.weeklyUsd * (1 - share), deskWeek: b.weeklyUsd * share, deskDaily: (b.weeklyUsd * share) / 7 };
}

/**
 * The companion's energy for chat and calls. Pure, so it can be tested.
 *
 * - The week's money (default $11.50) is split: the desk gets its share (15%), chat the rest.
 * - A rolling window (default $2.50 per 5 hours) spreads Full power out. Money not used in quieter
 *   windows earlier in the week tops a window up (by at most `rolloverCapUsd`).
 * - When the week or the window runs low, Low power (the small model) takes over smoothly and keeps
 *   going. Full power comes back when the window frees up or the week tops up.
 * - Everything rests only at the hard stop (default $48, under a $50 Console cap).
 */
export function computeEnergy(rows: SpendRow[], now: number, b: Budgets, tz: string): Energy {
  const weekStart = startOfWeek(now, tz, b.weekResetDay);
  const weekResetsAt = nextWeekStart(now, tz, b.weekResetDay);
  const windowStart = now - b.windowHours * HOUR;
  const monthStart = startOfMonth(now, tz);
  const { chatWeek } = splits(b);

  const chat = rows.filter((r) => r.bucket === "chat" && r.ts <= now);
  const weekRows = chat.filter((r) => r.ts >= weekStart);
  const windowRows = chat.filter((r) => r.ts > windowStart);
  const week = sum(weekRows);
  const window = sum(windowRows);
  const month = sum(rows.filter((r) => r.ts >= monthStart && r.ts <= now));
  const deskWeek = sum(rows.filter((r) => r.bucket === "desk" && r.ts >= weekStart && r.ts <= now));

  // Rollover: what the week's pace would have allowed before this window began, minus what was spent.
  const paceStart = clamp((Math.max(windowStart, weekStart) - weekStart) / WEEK, 0, 1);
  const spentBefore = sum(weekRows.filter((r) => r.ts <= windowStart));
  const rollover = clamp(chatWeek * paceStart - spentBefore, 0, b.rolloverCapUsd);
  const windowAllowance = b.windowUsd + rollover;

  const weekFrac = chatWeek > 0 ? 1 - week / chatWeek : 0;
  const windowFrac = windowAllowance > 0 ? 1 - window / windowAllowance : 0;
  const frac = clamp(Math.min(weekFrac, windowFrac), 0, 1);
  const percent = Math.round(frac * 100);
  const usd = { week, window, month, deskWeek, windowAllowance, chatWeekBudget: chatWeek };

  if (b.hardStopUsd > 0 && month >= b.hardStopUsd) {
    return { mode: "resting", percent: 0, fullBackAt: null, limitedBy: "month", weekResetsAt, usd };
  }
  const threshold = b.lowPowerAtPercent / 100;
  if (frac > threshold) return { mode: "full", percent, fullBackAt: null, limitedBy: null, weekResetsAt, usd };

  const limitedBy: "week" | "window" = weekFrac <= threshold ? "week" : "window";
  let fullBackAt = weekResetsAt;
  if (limitedBy === "window") {
    // The window frees up as old spending ages out of it.
    const target = windowAllowance * (1 - threshold);
    let remaining = window;
    fullBackAt = now;
    for (const r of [...windowRows].sort((a, c) => a.ts - c.ts)) {
      if (remaining <= target) break;
      remaining -= r.usd;
      fullBackAt = r.ts + b.windowHours * HOUR;
    }
  }
  return { mode: "low", percent, fullBackAt, limitedBy, weekResetsAt, usd };
}

/** The desk's daily slice of the week. Unused days roll forward within the same week. */
export function computeDeskEnergy(rows: SpendRow[], now: number, b: Budgets, tz: string): DeskEnergy {
  const weekStart = startOfWeek(now, tz, b.weekResetDay);
  const dayStart = startOfDay(now, tz);
  const monthStart = startOfMonth(now, tz);
  const { deskDaily } = splits(b);
  const desk = rows.filter((r) => r.bucket === "desk" && r.ts <= now);
  const week = sum(desk.filter((r) => r.ts >= weekStart));
  const today = sum(desk.filter((r) => r.ts >= dayStart));
  const daysSoFar = Math.min(7, Math.floor((dayStart - weekStart) / DAY + 0.5) + 1);
  const allowanceLeft = deskDaily * daysSoFar - week;
  const month = sum(rows.filter((r) => r.ts >= monthStart && r.ts <= now));
  const atStop = b.hardStopUsd > 0 && month >= b.hardStopUsd;
  const percent = deskDaily > 0 ? Math.round(clamp(allowanceLeft / deskDaily, 0, 1) * 100) : 0;
  return {
    canWork: allowanceLeft > 0 && !atStop,
    mode: percent > b.lowPowerAtPercent ? "full" : "low",
    percent,
    usd: { today, week, allowanceLeft, dailySlice: deskDaily },
  };
}

/** Straight-line projection of the month from spending so far. */
export function projectMonth(monthSpent: number, now: number, tz: string): number {
  const start = startOfMonth(now, tz);
  const p = localParts(now, tz);
  const next = p.month === 12 ? zonedTime(p.year + 1, 1, 1, 0, 0, tz) : zonedTime(p.year, p.month + 1, 1, 0, 0, tz);
  const frac = clamp((now - start) / (next - start), 1 / 62, 1);
  return monthSpent / frac;
}

// ── Ledger ───────────────────────────────────────────────────────────────────────────────────

export function recordSpend(db: DB, opts: { bucket: Bucket; kind: SpendKind; model: string; usage: UsageLike; ts?: number }) {
  const usd = costUsd(opts.model, opts.usage);
  run(
    db,
    "INSERT INTO spend(ts, usd, bucket, kind, model, input_tokens, output_tokens) VALUES (?,?,?,?,?,?,?)",
    opts.ts ?? Date.now(), usd, opts.bucket, opts.kind, opts.model,
    (opts.usage.input_tokens ?? 0) + (opts.usage.cache_read_input_tokens ?? 0) + (opts.usage.cache_creation_input_tokens ?? 0),
    opts.usage.output_tokens ?? 0,
  );
  return usd;
}

export function spendRows(db: DB, since: number): SpendRow[] {
  return all<SpendRow>(db, "SELECT ts, usd, bucket FROM spend WHERE ts >= ?", since);
}

/** Spending since the start of last month is all any calculation needs. */
export function recentRows(db: DB, now = Date.now()): SpendRow[] {
  return spendRows(db, now - 62 * DAY);
}

export function spendByKind(db: DB, since: number) {
  return all<{ kind: string; bucket: string; usd: number; calls: number }>(
    db,
    "SELECT kind, bucket, SUM(usd) AS usd, COUNT(*) AS calls FROM spend WHERE ts >= ? GROUP BY kind, bucket ORDER BY usd DESC",
    since,
  );
}

/** How often chat and calls ran on Low power since `since` (0–1). */
export function lowPowerShare(db: DB, since: number, lowModel: string): { share: number; turns: number } {
  const r = get<{ total: number; low: number }>(
    db,
    "SELECT COUNT(*) AS total, SUM(CASE WHEN model = ? THEN 1 ELSE 0 END) AS low FROM spend WHERE ts >= ? AND kind IN ('chat','talk','oc','study','story','art')",
    lowModel, since,
  );
  const total = r?.total ?? 0;
  return { share: total ? (r?.low ?? 0) / total : 0, turns: total };
}
