import { describe, expect, it } from "vitest";
import { all, get, openDb, run, MIGRATIONS } from "../src/db.js";
import { createReport, deliverReport, reportsToRetry, retryDelay, type Reporter } from "../src/reporting/reporter.js";

const MIN = 60_000;
const ctx = { companionName: "Pip", childName: "Sam" };

function fakeReporter(name: string, failTimes = 0) {
  const r = { name, sent: 0, tries: 0, async send() { r.tries++; if (r.tries <= failTimes) throw new Error(`${name} down`); r.sent++; } };
  return r as Reporter & { sent: number; tries: number };
}

describe("report delivery", () => {
  it("a retry only goes to the reporter that failed, after its backoff", async () => {
    const db = openDb(":memory:");
    const ok = fakeReporter("console");
    const flaky = fakeReporter("ha-board", 2);
    const t0 = Date.now();
    const rep = createReport(db, { level: "today", category: "worry", childNotice: "n", parentText: "p" });
    expect(await deliverReport(db, [ok, flaky], rep, ctx, t0)).toBe(false);
    expect(ok.sent).toBe(1);
    expect(get<{ status: string }>(db, "SELECT status FROM reports WHERE id = ?", rep.id)?.status).toBe("failed");

    // Too soon: nothing is tried.
    for (const r of reportsToRetry(db, t0 + 2 * MIN)) await deliverReport(db, [ok, flaky], r, ctx, t0 + 2 * MIN);
    expect(flaky.tries).toBe(1);
    // After 5 minutes the failed one is tried again (and fails), the one that worked isn't.
    for (const r of reportsToRetry(db, t0 + 5 * MIN)) await deliverReport(db, [ok, flaky], r, ctx, t0 + 5 * MIN);
    expect(flaky.tries).toBe(2);
    expect(ok.sent).toBe(1);
    // Next wait is 15 minutes.
    for (const r of reportsToRetry(db, t0 + 15 * MIN)) await deliverReport(db, [ok, flaky], r, ctx, t0 + 15 * MIN);
    expect(flaky.tries).toBe(2);
    for (const r of reportsToRetry(db, t0 + 21 * MIN)) await deliverReport(db, [ok, flaky], r, ctx, t0 + 21 * MIN);
    expect(flaky.tries).toBe(3);
    expect(flaky.sent).toBe(1);
    expect(ok.sent).toBe(1);
    expect(get<{ status: string }>(db, "SELECT status FROM reports WHERE id = ?", rep.id)?.status).toBe("delivered");
    expect(reportsToRetry(db, t0 + 90 * MIN)).toHaveLength(0);
  });

  it("backs off 5, 15, 60 minutes, then hourly", () => {
    expect([1, 2, 3, 4, 9].map((n) => retryDelay(n) / MIN)).toEqual([5, 15, 60, 60, 60]);
  });

  it("picks up reports left pending by a restart, and gives up after 7 days", () => {
    const db = openDb(":memory:");
    const now = Date.now();
    run(db, "INSERT INTO reports(ts, level, category, child_notice, parent_text, status) VALUES (?, 'now', 'x', 'n', 'p', 'pending')", now - 10 * MIN);
    run(db, "INSERT INTO reports(ts, level, category, child_notice, parent_text, status) VALUES (?, 'now', 'x', 'n', 'p', 'pending')", now - 10_000);
    run(db, "INSERT INTO reports(ts, level, category, child_notice, parent_text, status) VALUES (?, 'now', 'x', 'n', 'p', 'failed')", now - 8 * 24 * 60 * MIN);
    expect(reportsToRetry(db, now).map((r) => r.ts)).toEqual([now - 10 * MIN]);
  });
});

describe("migrations", () => {
  it("are numbered with user_version and run once", () => {
    const db = openDb(":memory:");
    expect(get<{ user_version: number }>(db, "PRAGMA user_version")?.user_version).toBe(MIGRATIONS.length);
    const idx = all<{ name: string }>(db, "SELECT name FROM sqlite_master WHERE type = 'index'").map((r) => r.name);
    expect(idx).toEqual(expect.arrayContaining(["checkins_ts", "tool_log_ts", "reports_status"]));
    expect(get<{ secure_delete: number }>(db, "PRAGMA secure_delete")?.secure_delete).toBe(1);
  });
});

// ── Scheduler ───────────────────────────────────────────────────────────────────────────────
import { retention, runOnce, takeAttempt, weeklyVacuum } from "../src/scheduler.js";
import { nextRun, parseLocal } from "../src/companion/schedules.js";
import { gather } from "../src/companion/heartbeat.js";
import { startOfDay, zonedTime } from "../src/budget/time.js";
import { loadProfile, saveProfile } from "../src/settings.js";
import type { LLM } from "../src/llm.js";
import type { SafetyChecker } from "../src/safety/check.js";

const TZ = "Europe/London";
const DAY = 24 * 60 * MIN;
const local = (s: string) => parseLocal(s, TZ);

describe("scheduler", () => {
  it("journal and summary attempts are capped per period and spaced out", () => {
    const db = openDb(":memory:");
    const t = Date.now();
    expect(takeAttempt(db, "journal", "2026-11-25", t)).toBe(true);
    expect(takeAttempt(db, "journal", "2026-11-25", t + 5 * MIN)).toBe(false); // too soon
    expect(takeAttempt(db, "journal", "2026-11-25", t + 31 * MIN)).toBe(true);
    expect(takeAttempt(db, "journal", "2026-11-25", t + 62 * MIN)).toBe(true);
    expect(takeAttempt(db, "journal", "2026-11-25", t + 200 * MIN)).toBe(false); // used up for the day
    expect(takeAttempt(db, "journal", "2026-11-26", t + 200 * MIN)).toBe(true);
    expect(takeAttempt(db, "summary", "2026-11-23", t)).toBe(true);
  });

  it("a failing step doesn't stop the rest of the tick", async () => {
    const db = openDb(":memory:");
    saveProfile(db, { ...loadProfile(db), setupDone: true });
    const llm = { available: true, call: async () => ({ content: [{ type: "text", text: JSON.stringify({ action: "nothing", message: "", why: "all quiet" }) }], stop_reason: "end_turn", usage: {} }) } as unknown as LLM;
    const safety = { checkOutput: async () => ({ ok: true, categories: [], reason: "" }) } as unknown as SafetyChecker;
    const studio = { desk: { tidy: () => { throw new Error("desk is down"); } } } as never;
    const noon = Date.UTC(2026, 10, 25, 12, 0);
    await runOnce({ db, llm, safety, reporters: [], childName: "Sam", studio }, noon);
    expect(all(db, "SELECT * FROM heartbeats")).toHaveLength(1); // the heartbeat ran after the disk step failed
  });

  it("retention clears the child's words from side tables and keeps the journal a year", () => {
    const db = openDb(":memory:");
    const now = Date.now();
    const old = now - 40 * DAY;
    run(db, "INSERT INTO help_log(ts, subject, asked, help) VALUES (?, 'maths', 'a question', 'help')", old);
    run(db, "INSERT INTO threads(ts, title, from_text, updated) VALUES (?, 'side', 'what she said', ?)", old, old);
    run(db, "INSERT INTO google_actions(ts, kind, title, lines, payload, status) VALUES (?, 'doc', 't', '[]', '{\"text\":\"x\"}', 'applied')", old);
    run(db, "INSERT INTO desk_jobs(ts, kind, title, request, status, updated) VALUES (?, 'story', 't', '{\"brief\":\"x\"}', 'done', ?)", old, old);
    run(db, "INSERT INTO journal(day, text, created) VALUES ('2025-01-01', 'old', ?)", now - 400 * DAY);
    run(db, "INSERT INTO journal(day, text, created) VALUES ('2026-01-01', 'recent', ?)", now - 300 * DAY);
    run(db, "INSERT INTO summaries(week_start, text, created) VALUES ('2025-01-01', 'old', ?)", now - 400 * DAY);
    retention(db, now);
    expect(all(db, "SELECT * FROM help_log")).toHaveLength(0);
    expect(get<{ from_text: string | null }>(db, "SELECT from_text FROM threads WHERE title = 'side'")?.from_text).toBeNull();
    expect(get<{ payload: string }>(db, "SELECT payload FROM google_actions")?.payload).toBe("{}");
    expect(get<{ request: string }>(db, "SELECT request FROM desk_jobs")?.request).toBe("{}");
    expect(all<{ text: string }>(db, "SELECT text FROM journal").map((r) => r.text)).toEqual(["recent"]);
    expect(all(db, "SELECT * FROM summaries")).toHaveLength(0);
  });

  it("vacuums about once a week", () => {
    const db = openDb(":memory:");
    const t = Date.now();
    expect(weeklyVacuum(db, t)).toBe(false); // starts the clock
    expect(weeklyVacuum(db, t + DAY)).toBe(false);
    expect(weeklyVacuum(db, t + 7 * DAY)).toBe(true);
  });
});

describe("clock changes (Europe/London, 2026)", () => {
  it("a daily 01:30 schedule goes back to 01:30 after the clocks go forward (29 March)", () => {
    // 01:30 doesn't exist on 29 March; it comes out at 02:30 BST that day.
    const moved = local("2026-03-29T01:30");
    expect(nextRun(moved, "daily", TZ, "01:30")).toBe(local("2026-03-30T01:30"));
    expect(new Date(local("2026-03-30T01:30")).toISOString()).toBe("2026-03-30T00:30:00.000Z");
  });
  it("a daily 19:00 schedule stays at 19:00 across both changes", () => {
    expect(nextRun(local("2026-03-28T19:00"), "daily", TZ, "19:00")).toBe(Date.UTC(2026, 2, 29, 18, 0));
    expect(nextRun(local("2026-10-24T19:00"), "daily", TZ, "19:00")).toBe(Date.UTC(2026, 9, 25, 19, 0));
    expect(nextRun(local("2026-10-25T01:30"), "daily", TZ, "01:30")).toBe(Date.UTC(2026, 9, 26, 1, 30));
  });
  it("start of day is local midnight, on 23- and 25-hour days", () => {
    expect(startOfDay(Date.UTC(2026, 2, 29, 19, 0), TZ)).toBe(Date.UTC(2026, 2, 29, 0, 0));
    expect(startOfDay(Date.UTC(2026, 9, 25, 20, 0), TZ)).toBe(Date.UTC(2026, 9, 24, 23, 0));
    expect(Date.UTC(2026, 2, 30, 0, 0) - 60 * MIN - startOfDay(Date.UTC(2026, 2, 29, 19, 0), TZ)).toBe(23 * 60 * MIN);
  });
  it("the heartbeat counts today's check-ins from local midnight", () => {
    const db = openDb(":memory:");
    // 20:00 BST on 29 March. Counting back 20 hours would reach 23:00 GMT on the 28th.
    const now = zonedTime(2026, 3, 29, 20, 0, TZ);
    run(db, "INSERT INTO checkins(ts, kind, text, delivered) VALUES (?, 'x', 'late yesterday', 1)", zonedTime(2026, 3, 28, 23, 30, TZ));
    run(db, "INSERT INTO checkins(ts, kind, text, delivered) VALUES (?, 'x', 'this morning', 1)", zonedTime(2026, 3, 29, 9, 0, TZ));
    expect(gather(db, now).checkinsToday).toBe(1);
    // October: 25 hours in the day; 00:30 on the 25th is today.
    const oct = zonedTime(2026, 10, 25, 20, 0, TZ);
    run(db, "INSERT INTO checkins(ts, kind, text, delivered) VALUES (?, 'x', 'just after midnight', 1)", zonedTime(2026, 10, 25, 0, 30, TZ));
    expect(gather(db, oct).checkinsToday).toBe(1);
  });
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listHistory, purgeHistory, writeHistory } from "../src/companion/history.js";

describe("history archive retention", () => {
  it("goes by the chapter's last day, not the file's time", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kith-hist-ret-"));
    const msg = (id: number, iso: string) => ({ id, ts: Date.parse(iso), role: "child", text: "hi" });
    // A chapter from 1 to 20 October, and one that ended on 1 October.
    writeHistory({ thread: 1, threadTitle: "Chat", companionName: "Pip", childName: "Sam", summary: "x", messages: [msg(1, "2026-10-01T12:00:00Z"), msg(2, "2026-10-20T12:00:00Z")] }, dir);
    writeHistory({ thread: 2, threadTitle: "Side", companionName: "Pip", childName: "Sam", summary: "x", messages: [msg(3, "2026-09-25T12:00:00Z"), msg(4, "2026-10-01T12:00:00Z")] }, dir);
    expect(listHistory(dir).find((h) => h.thread === 1)?.to).toBe("2026-10-20");
    // Files freshly copied (new mtime), 30 days kept, now = 10 November: only the chapter ending 1 October goes.
    purgeHistory(30, Date.parse("2026-11-10T12:00:00Z"), dir);
    expect(listHistory(dir).map((h) => h.thread)).toEqual([1]);
  });
});

// ── Budget ───────────────────────────────────────────────────────────────────────────────────
import Anthropic from "@anthropic-ai/sdk";
import { computeDeskEnergy, computeEnergy, worstTurnUsd } from "../src/budget/budget.js";
import { estimateCostUsd } from "../src/budget/pricing.js";
import { metered } from "../src/llm.js";
import { Budgets } from "../src/settings.js";

describe("budget strictness", () => {
  const params = { model: "claude-sonnet-5-5", max_tokens: 8000, messages: [{ role: "user" as const, content: "hello" }] };
  const spend = (db: ReturnType<typeof openDb>) => all<{ usd: number; output_tokens: number }>(db, "SELECT usd, output_tokens FROM spend");

  it("reserves the worst case while a call runs, then settles to the real cost", async () => {
    const db = openDb(":memory:");
    let during = 0;
    await metered(db, { bucket: "chat", kind: "chat", params }, async () => {
      during = spend(db)[0].usd;
      return { usage: { input_tokens: 100, output_tokens: 50 } } as Anthropic.Message;
    });
    expect(during).toBeCloseTo(estimateCostUsd(params));
    expect(during).toBeGreaterThanOrEqual(0.08); // 8000 output tokens at $10/M
    expect(spend(db)[0].usd).toBeCloseTo((100 * 2 + 50 * 10) / 1e6);
  });

  it("counts a call that timed out or broke mid-stream; drops one the API refused", async () => {
    const db = openDb(":memory:");
    await expect(metered(db, { bucket: "chat", kind: "chat", params }, async () => { throw new Anthropic.APIConnectionTimeoutError(); })).rejects.toThrow();
    expect(spend(db)).toHaveLength(1); // worst case kept
    await expect(metered(db, { bucket: "chat", kind: "chat", params }, async (seen) => {
      seen.usage = { input_tokens: 1000, output_tokens: 300 };
      throw new Error("stream broke");
    })).rejects.toThrow();
    expect(spend(db)[1].output_tokens).toBe(300);
    await expect(metered(db, { bucket: "chat", kind: "chat", params }, async () => {
      throw Anthropic.APIError.generate(429, { type: "error", error: { type: "rate_limit_error", message: "slow down" } }, "slow down", new Headers());
    })).rejects.toThrow();
    expect(spend(db)).toHaveLength(2);
  });

  it("Full power stops before one worst-case turn could pass the hard stop", () => {
    const b = Budgets.parse({ hardStopUsd: 48, weeklyUsd: 500, windowUsd: 100 });
    const now = Date.UTC(2026, 10, 25, 16, 0);
    const full = worstTurnUsd("claude-sonnet-5-5");
    const margin = { fullTurnUsd: full, lowTurnUsd: worstTurnUsd("claude-haiku-5-5") };
    const rows = (usd: number) => [{ ts: Date.UTC(2026, 10, 2), usd, bucket: "desk" as const }];
    expect(computeEnergy(rows(40), now, b, TZ, margin).mode).toBe("full");
    const near = computeEnergy(rows(48 - full + 0.01), now, b, TZ, margin);
    expect(near.mode).toBe("low");
    expect(near.limitedBy).toBe("month");
    expect(near.fullBackAt).toBe(Date.UTC(2026, 11, 1));
    expect(computeEnergy(rows(47.99), now, b, TZ, margin).mode).toBe("resting");
    expect(computeDeskEnergy(rows(48 - full + 0.01), now, Budgets.parse({ hardStopUsd: 48, weeklyUsd: 500 }), TZ, full).canWork).toBe(false);
  });
});
