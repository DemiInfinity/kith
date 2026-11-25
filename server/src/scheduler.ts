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
import { localDate, localParts, startOfWeek } from "./budget/time.js";
import { textOf, type LLM } from "./llm.js";
import { isGuiltTrip, redactPersonal } from "./safety/rules.js";
import type { SafetyChecker } from "./safety/check.js";
import { deliverReport, failedReports, type Reporter } from "./reporting/reporter.js";
import { allRollingKeys } from "./companion/context.js";
import { purgeHistory } from "./companion/history.js";
import { logActivity } from "./desk/activity.js";

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

export interface SchedulerDeps { db: DB; llm: LLM; safety: SafetyChecker; reporters: Reporter[]; childName: string }

export function startScheduler(deps: SchedulerDeps) {
  const tick = () => runOnce(deps).catch((err) => console.error("[scheduler]", err));
  setTimeout(tick, 10_000);
  return setInterval(tick, 5 * MIN);
}

export async function runOnce(deps: SchedulerDeps, now = Date.now()) {
  retention(deps.db, now);
  await retryReports(deps);
  await checkins(deps, now);
  await journal(deps, now);
  await weeklySummary(deps, now);
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
  run(db, "DELETE FROM sessions WHERE expires < ?", now);
  run(db, "DELETE FROM oidc_state WHERE created < ?", now - 15 * MIN);
  // Reports, summaries and the journal are kept for a year so both can look back.
  run(db, "DELETE FROM reports WHERE ts < ?", now - 365 * DAY);
  run(db, "DELETE FROM spend WHERE ts < ?", now - 400 * DAY);
}

async function retryReports(deps: SchedulerDeps) {
  const profile = loadProfile(deps.db);
  for (const r of failedReports(deps.db)) {
    await deliverReport(deps.db, deps.reporters, r, { companionName: profile.name, childName: deps.childName });
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

async function journal(deps: SchedulerDeps, now: number) {
  const { db, llm } = deps;
  const p = localParts(now, config.timezone);
  if (p.hour < 20 || !llm.available) return;
  const day = localDate(now, config.timezone);
  if (get(db, "SELECT id FROM journal WHERE day = ?", day)) return;
  const since = now - (p.hour * 60 + p.minute) * MIN;
  const count = get<{ n: number }>(db, "SELECT COUNT(*) AS n FROM messages WHERE role = 'child' AND ts >= ?", since)?.n ?? 0;
  if (count < 2) return;
  const desk = computeDeskEnergy(recentRows(db, now), now, loadParentSettings(db).budgets, config.timezone);
  if (!desk.canWork) return;
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
  run(db, "INSERT OR IGNORE INTO summaries(week_start, text, created) VALUES (?,?,?)", key, text, now);
}
