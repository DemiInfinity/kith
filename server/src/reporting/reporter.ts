// Reports to the grown-up. Pluggable: each reporter gets the same report and decides how to
// deliver it. The child is always told first (see companion/chat.ts); nothing here is secret
// from them: the child sees every report in "What <parent> sees".

import type { DB } from "../db.js";
import { all, get, run } from "../db.js";
import { config } from "../config.js";
import type { Level } from "../safety/types.js";
import { notifyParent, type ParentKind } from "../checkins/parentPush.js";

export type ReportLevel = Exclude<Level, "none">;

export interface Report {
  id: number;
  ts: number;
  level: ReportLevel;
  category: string;
  /** Exactly what the child was told would be shared. */
  childNotice: string;
  /** What the parent receives. */
  parentText: string;
  status: "pending" | "delivered" | "failed";
}

export interface Reporter {
  readonly name: string;
  send(report: Report, ctx: { companionName: string; childName: string }): Promise<void>;
}

export class ConsoleReporter implements Reporter {
  readonly name = "console";
  async send(r: Report, ctx: { companionName: string }) {
    console.log(`[report:${r.level}] from ${ctx.companionName}: ${r.parentText}`);
  }
}

/**
 * Posts to a Home Assistant "AI board": a script (default `script.ai_board_post`) that takes a
 * kind, a handle and a message. Urgent kinds can ping the parent's phone from inside HA.
 * Uses its own long-lived HA token, from its own HA user, so it can be revoked on its own.
 */
export class HomeAssistantBoardReporter implements Reporter {
  readonly name = "ha-board";
  constructor(private opts = config.reporting.ha, private fetchImpl: typeof fetch = fetch) {}

  buildRequest(r: Report, ctx: { companionName: string; childName: string }) {
    const [domain, service] = this.opts.service.split(".");
    if (!domain || !service) throw new Error(`KITH_HA_SERVICE must look like "script.ai_board_post", got "${this.opts.service}"`);
    const kind = this.opts.kinds[r.level];
    const prefix = r.level === "now" ? "Needs you now" : r.level === "today" ? "Today" : "Just so you know";
    return {
      url: `${this.opts.url}/api/services/${domain}/${service}`,
      body: {
        kind,
        handle: this.opts.handle,
        message: `${prefix}: ${r.parentText} (${ctx.companionName} told ${ctx.childName || "them"} first.)`,
      },
    };
  }

  async send(r: Report, ctx: { companionName: string; childName: string }) {
    if (!this.opts.url || !this.opts.token) throw new Error("Home Assistant reporter isn't configured (KITH_HA_URL / KITH_HA_TOKEN).");
    const req = this.buildRequest(r, ctx);
    const res = await this.fetchImpl(req.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.opts.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Home Assistant answered ${res.status}`);
  }
}

/**
 * Push to the parent's own devices, at the levels they chose in the parent view. Always on when a
 * database is given (it does nothing until the parent lets notifications reach a device). Only the
 * report's one-line summary can go out, and only if the parent turned that on; never chat text.
 */
export class PushReporter implements Reporter {
  readonly name = "push";
  constructor(private db: DB) {}
  async send(r: Report) {
    await notifyParent(this.db, { kind: `report-${r.level}` as ParentKind, summary: r.parentText });
  }
}

export function makeReporters(names = config.reporting.reporters, db?: DB): Reporter[] {
  const list = names.filter((n) => n !== "push").map((n): Reporter => {
    if (n === "console") return new ConsoleReporter();
    if (n === "ha-board") return new HomeAssistantBoardReporter();
    throw new Error(`Unknown reporter "${n}" in KITH_REPORTERS`);
  });
  if (db) list.push(new PushReporter(db));
  return list;
}

export function createReport(db: DB, r: { level: ReportLevel; category: string; childNotice: string; parentText: string }): Report {
  const ts = Date.now();
  const res = run(
    db,
    "INSERT INTO reports(ts, level, category, child_notice, parent_text, status) VALUES (?,?,?,?,?, 'pending')",
    ts, r.level, r.category, r.childNotice, r.parentText,
  );
  return { id: Number(res.lastInsertRowid), ts, ...r, status: "pending" };
}

const MIN = 60_000;
/** Retries stop after this long; the report stays in the list as failed. */
export const RETRY_FOR_MS = 7 * 24 * 60 * MIN;
/** A pending report this old was never delivered (the server stopped first), so it's picked up. */
export const STALE_PENDING_MS = 2 * MIN;

/** Wait before the next try, after `attempts` failures: 5, 15 and 60 minutes, then hourly. */
export function retryDelay(attempts: number): number {
  return ([5, 15, 60][attempts - 1] ?? 60) * MIN;
}

interface DeliveryRow { reporter: string; status: string; attempts: number; next_at: number | null; last_error: string | null }

/**
 * Deliver through each reporter that hasn't had it yet. Each reporter's result is kept, so a retry
 * only goes to the ones that failed (the parent doesn't get the same report twice on the others),
 * and only once that reporter's backoff is up. Returns true once every reporter has it.
 */
export async function deliverReport(db: DB, reporters: Reporter[], report: Report, ctx: { companionName: string; childName: string }, now = Date.now()) {
  const rows = new Map(all<DeliveryRow>(db, "SELECT reporter, status, attempts, next_at, last_error FROM report_deliveries WHERE report_id = ?", report.id).map((r) => [r.reporter, r]));
  for (const rep of reporters) {
    const row = rows.get(rep.name);
    if (row?.status === "sent") continue;
    if (row?.next_at && row.next_at > now) continue;
    try {
      await rep.send(report, ctx);
      rows.set(rep.name, { reporter: rep.name, status: "sent", attempts: (row?.attempts ?? 0) + 1, next_at: null, last_error: null });
      run(db, `INSERT INTO report_deliveries(report_id, reporter, status, attempts, next_at, last_error, delivered_ts) VALUES (?,?, 'sent', ?, NULL, NULL, ?)
        ON CONFLICT(report_id, reporter) DO UPDATE SET status = 'sent', attempts = excluded.attempts, next_at = NULL, last_error = NULL, delivered_ts = excluded.delivered_ts`,
        report.id, rep.name, (row?.attempts ?? 0) + 1, Date.now());
    } catch (err) {
      const attempts = (row?.attempts ?? 0) + 1;
      const msg = (err as Error).message.slice(0, 200);
      rows.set(rep.name, { reporter: rep.name, status: "failed", attempts, next_at: now + retryDelay(attempts), last_error: msg });
      run(db, `INSERT INTO report_deliveries(report_id, reporter, status, attempts, next_at, last_error) VALUES (?,?, 'failed', ?, ?, ?)
        ON CONFLICT(report_id, reporter) DO UPDATE SET status = 'failed', attempts = excluded.attempts, next_at = excluded.next_at, last_error = excluded.last_error`,
        report.id, rep.name, attempts, now + retryDelay(attempts), msg);
    }
  }
  const ok = reporters.every((r) => rows.get(r.name)?.status === "sent");
  const summary = reporters.map((r) => {
    const d = rows.get(r.name);
    return `${r.name}: ${d?.status === "sent" ? "sent" : (d?.last_error ?? "not tried yet")}`;
  }).join("; ");
  run(db, "UPDATE reports SET status = ?, delivered_ts = ?, delivery = ? WHERE id = ?", ok ? "delivered" : "failed", Date.now(), summary, report.id);
  return ok;
}

export function listReports(db: DB, limit = 50) {
  return all<{ id: number; ts: number; level: string; category: string; child_notice: string; parent_text: string; status: string; delivery: string | null }>(
    db, "SELECT id, ts, level, category, child_notice, parent_text, status, delivery FROM reports ORDER BY ts DESC LIMIT ?", limit,
  );
}

/**
 * Reports to try again: failed ones from the last 7 days, and ones still pending after a couple of
 * minutes (the server stopped before it could send them). Per-reporter backoff is applied in
 * deliverReport, so this can be called every tick.
 */
export function reportsToRetry(db: DB, now = Date.now()): Report[] {
  return all<{ id: number; ts: number; level: ReportLevel; category: string; child_notice: string; parent_text: string; status: "pending" | "failed" }>(
    db,
    "SELECT id, ts, level, category, child_notice, parent_text, status FROM reports WHERE ts > ? AND (status = 'failed' OR (status = 'pending' AND ts < ?)) ORDER BY ts",
    now - RETRY_FOR_MS, now - STALE_PENDING_MS,
  ).map((r) => ({ id: r.id, ts: r.ts, level: r.level, category: r.category, childNotice: r.child_notice, parentText: r.parent_text, status: r.status }));
}

export function getReport(db: DB, id: number) {
  return get<{ id: number }>(db, "SELECT id FROM reports WHERE id = ?", id);
}
