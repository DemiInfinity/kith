import type { DB } from "../db.js";
import { all, run } from "../db.js";
import type { Budgets } from "../settings.js";
import { costUsd, type UsageLike } from "./pricing.js";
import { nextWeekStart, startOfMonth, startOfWeek } from "./time.js";

export type Bucket = "chat" | "desk";
export type SpendKind = "chat" | "talk" | "safety" | "memory" | "summary" | "journal" | "checkin" | "artifact" | "oc";
export interface SpendRow { ts: number; usd: number; bucket: Bucket }

/** "full" uses the bigger model, "low" the small one, "resting" means no model calls until energy is back. */
export type PowerMode = "full" | "low" | "resting";

export interface Energy {
  mode: PowerMode;
  /** 0–100, what the child sees. */
  percent: number;
  /** When Full power comes back (if it's not on now), and why it's off. */
  fullBackAt: number | null;
  limitedBy: "week" | "window" | "month" | null;
  weekResetsAt: number;
  // Money, for the parent view.
  usd: { week: number; window: number; month: number; deskMonth: number };
}

export interface DeskEnergy {
  canWork: boolean;
  mode: "full" | "low";
  percent: number;
  usd: number;
}

const HOUR = 3_600_000;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const sum = (rows: SpendRow[]) => rows.reduce((t, r) => t + r.usd, 0);

/**
 * Works out the companion's energy from what has been spent. Pure, so it can be tested.
 *
 * - Weekly energy (default $11.50) tops up at local midnight on the reset day.
 * - A rolling window (default $3 over 5 hours) stops one long evening using the whole week.
 * - When either drops under `lowPowerAtPercent`, Low power (the small model) is used.
 * - Low power can keep going on a small reserve after the week is spent; after that it rests.
 * - The monthly cap is a backstop: the real cap is set on the API organisation in the Console.
 * Desk spending has its own monthly budget and never takes from chat energy (but does count
 * towards the monthly backstop).
 */
export function computeEnergy(rows: SpendRow[], now: number, b: Budgets, tz: string): Energy {
  const weekStart = startOfWeek(now, tz, b.weekResetDay);
  const weekResetsAt = nextWeekStart(now, tz, b.weekResetDay);
  const windowStart = now - b.windowHours * HOUR;
  const monthStart = startOfMonth(now, tz);

  const chat = rows.filter((r) => r.bucket === "chat");
  const weekRows = chat.filter((r) => r.ts >= weekStart && r.ts <= now);
  const windowRows = chat.filter((r) => r.ts > windowStart && r.ts <= now);
  const week = sum(weekRows);
  const window = sum(windowRows);
  const month = sum(rows.filter((r) => r.ts >= monthStart && r.ts <= now));
  const deskMonth = sum(rows.filter((r) => r.bucket === "desk" && r.ts >= monthStart && r.ts <= now));

  const weekFrac = b.weeklyUsd > 0 ? 1 - week / b.weeklyUsd : 0;
  const windowFrac = b.windowUsd > 0 ? 1 - window / b.windowUsd : 0;
  const frac = clamp(Math.min(weekFrac, windowFrac), 0, 1);
  const percent = Math.round(frac * 100);
  const usd = { week, window, month, deskMonth };

  const threshold = b.lowPowerAtPercent / 100;
  const limitedBy = weekFrac <= windowFrac ? "week" : "window";

  if (b.monthlyCapUsd > 0 && month >= b.monthlyCapUsd) {
    return { mode: "resting", percent: 0, fullBackAt: null, limitedBy: "month", weekResetsAt, usd };
  }
  if (frac > threshold) {
    return { mode: "full", percent, fullBackAt: null, limitedBy: null, weekResetsAt, usd };
  }

  // Full power is off. When does it come back?
  let fullBackAt: number;
  if (limitedBy === "week" || weekFrac <= threshold) {
    fullBackAt = weekResetsAt;
  } else {
    // The window frees up as old spending ages out of it.
    const target = b.windowUsd * (1 - threshold);
    const sorted = [...windowRows].sort((a, c) => a.ts - c.ts);
    let remaining = window;
    fullBackAt = now;
    for (const r of sorted) {
      if (remaining <= target) break;
      remaining -= r.usd;
      fullBackAt = r.ts + b.windowHours * HOUR;
    }
  }

  // Low power keeps going on the reserve, then rests until the week tops up.
  const reserveLeft = b.weeklyUsd + b.lowPowerReserveUsd - week;
  const windowReserveLeft = b.windowUsd + b.lowPowerReserveUsd / 2 - window;
  if (reserveLeft <= 0) {
    return { mode: "resting", percent: 0, fullBackAt: weekResetsAt, limitedBy: "week", weekResetsAt, usd };
  }
  if (windowReserveLeft <= 0) {
    return { mode: "resting", percent: 0, fullBackAt, limitedBy: "window", weekResetsAt, usd };
  }
  return { mode: "low", percent, fullBackAt, limitedBy, weekResetsAt, usd };
}

export function computeDeskEnergy(rows: SpendRow[], now: number, b: Budgets, tz: string): DeskEnergy {
  const monthStart = startOfMonth(now, tz);
  const usd = sum(rows.filter((r) => r.bucket === "desk" && r.ts >= monthStart && r.ts <= now));
  const month = sum(rows.filter((r) => r.ts >= monthStart && r.ts <= now));
  const frac = b.deskMonthlyUsd > 0 ? clamp(1 - usd / b.deskMonthlyUsd, 0, 1) : 0;
  const overMonthly = b.monthlyCapUsd > 0 && month >= b.monthlyCapUsd;
  return {
    canWork: frac > 0 && !overMonthly,
    mode: frac * 100 > b.lowPowerAtPercent ? "full" : "low",
    percent: Math.round(frac * 100),
    usd,
  };
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
  return spendRows(db, now - 62 * 24 * HOUR);
}

export function spendByKind(db: DB, since: number) {
  return all<{ kind: string; bucket: string; usd: number; calls: number }>(
    db,
    "SELECT kind, bucket, SUM(usd) AS usd, COUNT(*) AS calls FROM spend WHERE ts >= ? GROUP BY kind, bucket ORDER BY usd DESC",
    since,
  );
}
