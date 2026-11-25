// Background jobs, every few minutes: gentle check-ins, the daily journal, the weekly summary,
// deleting chats after the retention period, and retrying reports that didn't get through.

import type { DB } from "./db.js";
import { all, get, run } from "./db.js";
import { config } from "./config.js";
import { loadParentSettings, loadProfile } from "./settings.js";
import { listMemories } from "./companion/memory.js";
import { planCheckin, templateText } from "./checkins/plan.js";
import { pushToChild } from "./checkins/push.js";
import { computeDeskEnergy, recentRows } from "./budget/budget.js";
import { energyNow } from "./companion/chat.js";
import { localDate, localParts, startOfDay, startOfWeek } from "./budget/time.js";
import { textOf, type LLM } from "./llm.js";
import { isGuiltTrip, redactPersonal } from "./safety/rules.js";
import type { SafetyChecker } from "./safety/check.js";
import { deliverReport, releaseStuckReports, reportsToRetry, type Reporter } from "./reporting/reporter.js";
import { allRollingKeys } from "./companion/context.js";
import { purgeHistory } from "./companion/history.js";
import { logActivity } from "./desk/activity.js";
import { dueSchedules, listSchedules, markRan } from "./companion/schedules.js";
import type { Studio } from "./desk/studio.js";
import { heartbeat } from "./companion/heartbeat.js";
import { flushHeld, notifyParent } from "./checkins/parentPush.js";
import { diskUsage } from "./disk.js";
import { failStuckApplying } from "./storage/googleWork.js";

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

export interface SchedulerDeps { db: DB; llm: LLM; safety: SafetyChecker; reporters: Reporter[]; childName: string; studio?: Studio }

export const TICK_MS = 5 * MIN;
const startedAt = Date.now();
let lastTickAt = 0;

/** For the health check: the scheduler is alive if a tick finished recently (ticks can be slow). */
export function schedulerHealthy(now = Date.now()) {
  return now - Math.max(startedAt, lastTickAt) < 4 * TICK_MS;
}
export const lastSchedulerTick = () => lastTickAt;

export interface SchedulerHandle { stop(): Promise<void> }

/**
 * Ticks every 5 minutes, one at a time: the next tick is set only after the last one finishes, so
 * a slow tick (a long Claude call, a stuck reporter) can never overlap the next.
 */
export function startScheduler(deps: SchedulerDeps): SchedulerHandle {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let current: Promise<void> | null = null;
  const loop = async () => {
    timer = null;
    if (stopped) return;
    current = runOnce(deps).catch((err) => console.error("[scheduler]", err));
    await current;
    current = null;
    if (!stopped) timer = setTimeout(loop, TICK_MS);
  };
  timer = setTimeout(loop, 10_000);
  return {
    /** Stops ticking, and waits for a tick that's running to finish. */
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      await current;
    },
  };
}

/** Runs one step; a failure is logged and the rest of the tick carries on. */
async function step(name: string, fn: () => unknown) {
  try {
    await fn();
  } catch (err) {
    console.warn(`[scheduler:${name}]`, (err as Error)?.message ?? err);
  }
}

export async function runOnce(deps: SchedulerDeps, now = Date.now()) {
  await step("retention", () => retention(deps.db, now));
  await step("vacuum", () => weeklyVacuum(deps.db, now));
  await step("reports", () => retryReports(deps, now));
  await step("schedules", () => schedules(deps, now));
  await step("checkins", () => checkins(deps, now));
  await step("disk", () => disk(deps, now));
  await step("budget alert", () => budgetAlerts(deps.db, now));
  await step("held pushes", () => flushHeld(deps.db, now));
  await step("journal", () => journal(deps, now));
  await step("heartbeat", () => heartbeat({
    db: deps.db, llm: deps.llm, safety: deps.safety,
    deskCanWork: () => computeDeskEnergy(recentRows(deps.db, now), now, loadParentSettings(deps.db).budgets, config.timezone).canWork,
  }, now));
  await step("weekly summary", () => weeklySummary(deps, now));
  lastTickAt = Date.now();
}

/**
 * Background writing (the journal, the weekly summary) is tried at most `max` times per period,
 * at least `gapMs` apart, so a failing call doesn't run (and cost) on every tick. Returns false when
 * it's not time to try; otherwise records the attempt and returns true.
 */
export function takeAttempt(db: DB, job: string, period: string, now: number, max = 3, gapMs = 30 * MIN): boolean {
  const row = get<{ attempts: number; last_ts: number }>(db, "SELECT attempts, last_ts FROM job_attempts WHERE job = ? AND period = ?", job, period);
  if (row && (row.attempts >= max || now - row.last_ts < gapMs)) return false;
  run(db, "INSERT INTO job_attempts(job, period, attempts, last_ts) VALUES (?,?,1,?) ON CONFLICT(job, period) DO UPDATE SET attempts = attempts + 1, last_ts = excluded.last_ts", job, period, now);
  run(db, "DELETE FROM job_attempts WHERE last_ts < ?", now - 30 * DAY);
  return true;
}

/** Deleted rows are overwritten (secure_delete); a weekly VACUUM also gives the space back. */
export function weeklyVacuum(db: DB, now = Date.now()) {
  const row = get<{ json: string }>(db, "SELECT json FROM settings WHERE key = 'last_vacuum'");
  const last = row ? Number(JSON.parse(row.json)) : 0;
  if (now - last < 7 * DAY) return false;
  run(db, "INSERT INTO settings(key, json) VALUES('last_vacuum', ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json", JSON.stringify(now));
  if (last === 0) return false; // first run: just start the clock
  db.exec("VACUUM");
  return true;
}

export function retention(db: DB, now = Date.now()) {
  const days = loadParentSettings(db).retentionDays;
  const cutoff = now - days * DAY;
  run(db, "DELETE FROM messages WHERE ts < ?", cutoff);
  // Rolling summaries and the history archive are made from chats, so they go with them.
  for (const r of allRollingKeys(db)) {
    if ((JSON.parse(r.json) as { ts: number }).ts < cutoff) run(db, "DELETE FROM settings WHERE key = ?", r.key);
  }
  purgeHistory(days, now);
  run(db, "DELETE FROM checkins WHERE ts < ?", cutoff);
  run(db, "DELETE FROM tool_log WHERE ts < ?", cutoff);
  run(db, "DELETE FROM desk_activity WHERE ts < ?", cutoff);
  run(db, "DELETE FROM browse_log WHERE ts < ?", cutoff);
  // The coursework help log is kept for a year: it's what she shows her teacher for the
  // coursework declaration, so it has to last the school year.
  run(db, "DELETE FROM help_log WHERE ts < ?", now - 365 * DAY);
  // A Google change stuck in 'applying' for 15 minutes (the server stopped part-way) is failed.
  failStuckApplying(db, now);
  run(db, "UPDATE threads SET from_text = NULL WHERE from_text IS NOT NULL AND ts < ?", cutoff);
  run(db, "UPDATE google_actions SET payload = '{}' WHERE payload != '{}' AND ts < ? AND status NOT IN ('pending','applying')", cutoff);
  run(db, "DELETE FROM google_actions WHERE ts < ?", now - 365 * DAY);
  run(db, "UPDATE desk_jobs SET request = '{}' WHERE request != '{}' AND updated < ? AND status IN ('done','failed')", cutoff);
  run(db, "DELETE FROM report_deliveries WHERE report_id NOT IN (SELECT id FROM reports)");
  run(db, "DELETE FROM sessions WHERE expires < ?", now);
  run(db, "DELETE FROM oidc_state WHERE created < ?", now - 15 * MIN);
  run(db, "DELETE FROM auth_handoff WHERE created < ?", now - 2 * MIN);
  // Reports, summaries and the journal are kept for a year so both can look back.
  run(db, "DELETE FROM reports WHERE ts < ?", now - 365 * DAY);
  run(db, "DELETE FROM summaries WHERE created < ?", now - 365 * DAY);
  run(db, "DELETE FROM journal WHERE created < ?", now - 365 * DAY);
  run(db, "DELETE FROM spend WHERE ts < ?", now - 400 * DAY);
}

let lastTidy = 0;
/** Keeps an eye on disk use, and tidies the desk's trash about once an hour. */
async function disk(deps: SchedulerDeps, now: number) {
  if (!deps.studio) return;
  if (now - lastTidy > 3_600_000) {
    lastTidy = now;
    await deps.studio.desk.tidy(loadParentSettings(deps.db).disk.keepDays).catch(() => undefined);
  }
  deps.studio.disk = await diskUsage(deps.db, deps.studio.desk, true);
}

export async function retryReports(deps: Pick<SchedulerDeps, "db" | "reporters" | "childName">, now = Date.now()) {
  const profile = loadProfile(deps.db);
  // A report whose "telling her" reply never got saved (a crash) is sent anyway, with a note.
  releaseStuckReports(deps.db, now);
  for (const r of reportsToRetry(deps.db, now)) {
    await deliverReport(deps.db, deps.reporters, r, { companionName: profile.name, childName: deps.childName }, now);
  }
}

async function checkins(deps: SchedulerDeps, now: number) {
  const { db } = deps;
  const settings = loadParentSettings(db);
  const profile = loadProfile(db);
  if (!profile.setupDone) return;
  const plan = planCheckin({
    now,
    tz: config.timezone,
    quietHours: settings.quietHours,
    maxPerDay: settings.maxCheckinsPerDay,
    sentTimes: all<{ ts: number }>(db, "SELECT ts FROM checkins WHERE ts > ?", now - 2 * DAY).map((r) => r.ts),
    lastChildMessageAt: get<{ ts: number }>(db, "SELECT MAX(ts) AS ts FROM messages WHERE role = 'child'")?.ts ?? null,
    toggles: profile.checkins,
    memories: listMemories(db),
    recentChildMessageTimes: all<{ ts: number }>(db, "SELECT ts FROM messages WHERE role = 'child' AND ts > ?", now - 60 * MIN).map((r) => r.ts),
  });
  if (!plan) return;

  let text = templateText(plan, localParts(now, config.timezone).day);
  // A friendlier "how did it go?" when there's energy for it; it must pass the same checks.
  if (plan.kind === "how_did_it_go" && deps.llm.available && energyNow(db).mode !== "resting") {
    try {
      const msg = await deps.llm.call({
        bucket: "chat",
        kind: "checkin",
        params: {
          model: config.anthropic.lowModel,
          max_tokens: 400,
          output_config: { effort: "low" },
          system: `You are ${profile.name}, a friendly AI companion. Write one short check-in message (under 20 words) asking how something went. End with "No rush, tell me whenever." No guilt, no "I missed you", no pressure. One emoji at most.`,
          messages: [{ role: "user", content: `The thing: ${plan.memoryText}` }],
        } as never,
      });
      const t = textOf(msg);
      if (t && !isGuiltTrip(t) && (await deps.safety.checkOutput(t, "")).ok) text = t;
    } catch {
      // keep the template
    }
  }
  if (isGuiltTrip(text)) return;

  const delivered = await pushToChild(db, { title: profile.name, body: text, url: "/" });
  run(db, "INSERT INTO checkins(ts, kind, text, delivered) VALUES (?,?,?,?)", now, plan.kind, text, delivered);
  run(db, "INSERT INTO messages(ts, role, text, mode, meta) VALUES (?, 'companion', ?, 'chat', ?)", now, text, JSON.stringify({ checkin: plan.kind }));
  if (plan.memoryId) run(db, "UPDATE memories SET asked = 1 WHERE id = ?", plan.memoryId);
}

/** Things the child asked to have scheduled. */
async function schedules(deps: SchedulerDeps, now: number) {
  const { db } = deps;
  const settings = loadParentSettings(db);
  const profile = loadProfile(db);
  for (const s of dueSchedules(listSchedules(db), now, config.timezone, settings.quietHours)) {
    if (s.kind === "reminder") {
      const text = `⏰ ${s.title}`;
      await pushToChild(db, { title: profile.name, body: text, url: "/" }, "reminders");
      run(db, "INSERT INTO messages(ts, role, text, mode, meta) VALUES (?, 'companion', ?, 'chat', ?)", now, text, JSON.stringify({ schedule: s.id }));
      logActivity(db, "⏰", `Reminder: ${s.title}`);
    } else if (deps.studio) {
      const make = JSON.parse(s.payload) as { kind: string; brief: string; lookUp?: string };
      const job = deps.studio.enqueue({ kind: make.kind as never, title: s.title, brief: make.brief, lookUp: make.lookUp });
      if (!job.ok) logActivity(db, "⚠️", `Couldn't start scheduled “${s.title}”: ${job.error}`);
    }
    markRan(db, s, now, config.timezone);
  }
}

async function journal(deps: SchedulerDeps, now: number) {
  const { db, llm } = deps;
  const p = localParts(now, config.timezone);
  if (p.hour < 20 || !llm.available) return;
  const day = localDate(now, config.timezone);
  if (get(db, "SELECT id FROM journal WHERE day = ?", day)) return;
  const since = startOfDay(now, config.timezone);
  const count = get<{ n: number }>(db, "SELECT COUNT(*) AS n FROM messages WHERE role = 'child' AND ts >= ?", since)?.n ?? 0;
  if (count < 2) return;
  // The desk's energy covers the hard stop too.
  const desk = computeDeskEnergy(recentRows(db, now), now, loadParentSettings(db).budgets, config.timezone);
  if (!desk.canWork) return;
  if (!takeAttempt(db, "journal", day, now)) return;
  const profile = loadProfile(db);
  const memories = listMemories(db).slice(0, 10).map((m) => m.text).join("; ");
  const jobs = all<{ title: string }>(db, "SELECT title FROM desk_jobs WHERE ts >= ? AND status = 'done'", since).map((j) => j.title).join("; ");
  const topics = all<{ text: string }>(db, "SELECT text FROM messages WHERE role = 'child' AND ts >= ? ORDER BY ts LIMIT 40", since)
    .map((m) => redactPersonal(m.text).text.slice(0, 200)).join("\n");
  try {
    const msg = await llm.call({
      bucket: "desk",
      kind: "journal",
      params: {
        model: config.anthropic.lowModel,
        max_tokens: 600,
        output_config: { effort: "low" },
        system: `You are ${profile.name}, an AI companion, writing a one or two sentence entry in your journal on your desk. Their grown-up can see your desk too, so write only cheerful, topic-level things you did together (homework topics, stories, things you made). Never anything private, worrying or personal, no quotes. Warm, a little playful.`,
        messages: [{ role: "user", content: `Today's topics (for you only, don't quote):\n${topics}\n\nThings remembered: ${memories}\nMade on the desk: ${jobs || "nothing"}` }],
      } as never,
    });
    const text = textOf(msg);
    if (text && (await deps.safety.checkOutput(text, "")).ok) {
      run(db, "INSERT OR IGNORE INTO journal(day, text, created) VALUES (?,?,?)", day, text.slice(0, 500), now);
      logActivity(db, "📔", "Wrote in its journal");
    }
  } catch (err) {
    console.warn("[journal]", (err as Error).message);
  }
}

async function weeklySummary(deps: SchedulerDeps, now: number) {
  const { db, llm } = deps;
  const tz = config.timezone;
  const p = localParts(now, tz);
  // Sunday evening.
  if (p.weekday !== 0 || p.hour < 18 || !llm.available) return;
  const weekStart = startOfWeek(now, tz, 1);
  const key = localDate(weekStart, tz);
  if (get(db, "SELECT id FROM summaries WHERE week_start = ?", key)) return;
  const profile = loadProfile(db);
  const parent = config.people.parentLabel;
  const topics = all<{ text: string }>(db, "SELECT text FROM messages WHERE role = 'child' AND ts >= ? ORDER BY ts LIMIT 200", weekStart)
    .map((m) => redactPersonal(m.text).text.slice(0, 160)).join("\n");
  const made = all<{ title: string }>(db, "SELECT title FROM desk_jobs WHERE ts >= ? AND status = 'done'", weekStart).map((j) => j.title);
  const reports = get<{ n: number }>(db, "SELECT COUNT(*) AS n FROM reports WHERE ts >= ?", weekStart)?.n ?? 0;
  let text: string;
  if (topics && energyNow(db).mode === "resting") return; // at the hard stop: no Claude calls
  if (topics && !takeAttempt(db, "summary", key, now)) return;
  // With chats kept for less than a week, the summary can only cover the days still kept.
  const days = loadParentSettings(db).retentionDays;
  const covers = days < 7 ? ` (This only covers the last ${days} day${days === 1 ? "" : "s"}: chats are only kept that long.)` : "";
  if (!topics) {
    text = `A quiet week: no chats with ${profile.name}.${reports ? "" : ` ${profile.name} didn't need to tell ${parent} about anything.`}`;
  } else {
    try {
      const msg = await llm.call({
        bucket: "chat",
        kind: "summary",
        params: {
          model: config.anthropic.lowModel,
          max_tokens: 800,
          output_config: { effort: "low" },
          system: `Write a weekly summary that a teenager and their ${parent} will BOTH read. Two or three sentences, topic level only: what kinds of things they did with ${profile.name} (homework subjects, stories, projects, things made). No quotes, no feelings, no private details, nothing about friendships or worries. Then say whether ${profile.name} needed to tell ${parent} about anything this week (it's given below). Warm and plain.`,
          messages: [{ role: "user", content: `Topics this week (don't quote):\n${topics}\n\nMade on the desk: ${made.join(", ") || "nothing"}\nReports to ${parent} this week: ${reports}` }],
        } as never,
      });
      text = textOf(msg);
      if (!(await deps.safety.checkOutput(text, "")).ok) return;
    } catch (err) {
      console.warn("[summary]", (err as Error).message);
      return;
    }
  }
  run(db, "INSERT OR IGNORE INTO summaries(week_start, text, created) VALUES (?,?,?)", key, text + covers, now);
  await notifyParent(db, { kind: "weekly" }, now);
}

/**
 * Budget alerts for the parent: once when Low power starts (again only after Full power came back),
 * and once a month when the hard stop is reached.
 */
export async function budgetAlerts(db: DB, now = Date.now()) {
  const e = energyNow(db);
  const row = get<{ json: string }>(db, "SELECT json FROM settings WHERE key = 'budget_alert'");
  const st = row ? (JSON.parse(row.json) as { low: boolean; hardStopMonth: string }) : { low: false, hardStopMonth: "" };
  const month = localDate(now, config.timezone).slice(0, 7);
  const next = { ...st };
  const profile = loadProfile(db);
  if (e.mode === "full") next.low = false;
  if (e.mode === "low" && !st.low) {
    next.low = true;
    await notifyParent(db, { kind: "budget", summary: `${profile.name} switched to Low power (${e.limitedBy === "week" ? "this week's budget ran low" : e.limitedBy === "month" ? "it's close to the monthly hard stop" : "the current window ran low"}).` }, now);
  }
  if (e.mode === "resting" && e.limitedBy === "month" && st.hardStopMonth !== month) {
    next.hardStopMonth = month;
    await notifyParent(db, { kind: "budget", summary: `The monthly hard stop was reached: ${profile.name} is resting until it tops up.` }, now);
  }
  if (JSON.stringify(next) !== JSON.stringify(st)) {
    run(db, "INSERT INTO settings(key, json) VALUES('budget_alert', ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json", JSON.stringify(next));
  }
}
