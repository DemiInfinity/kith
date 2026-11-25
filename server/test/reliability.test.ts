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
