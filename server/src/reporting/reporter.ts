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
  status: ReportStatus;
}

/**
 * awaiting_reply: made before the reply that tells her, and never sent while it's here.
 * pending: she's been told; ready to send. sending: claimed by one sender (so it's only sent once).
 * child_not_told: stuck in awaiting_reply (the server stopped before her reply was saved); sent
 * anyway, with a note that she may not have seen the message. delivered / failed: how sending went.
 */
export type ReportStatus = "awaiting_reply" | "pending" | "sending" | "child_not_told" | "delivered" | "failed";

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

/**
 * Records a report. With `awaitingReply`, it waits (status awaiting_reply) until `markTold` says the
 * reply that tells her has been saved; nothing sends it before then.
 */
export function createReport(db: DB, r: { level: ReportLevel; category: string; childNotice: string; parentText: string }, opts: { awaitingReply?: boolean } = {}): Report {
  const ts = Date.now();
  const status: ReportStatus = opts.awaitingReply ? "awaiting_reply" : "pending";
  const res = run(
    db,
    "INSERT INTO reports(ts, level, category, child_notice, parent_text, status) VALUES (?,?,?,?,?,?)",
    ts, r.level, r.category, r.childNotice, r.parentText, status,
  );
  return { id: Number(res.lastInsertRowid), ts, ...r, status };
}

/** The reply that tells her is stored: the report can now be sent. */
export function markTold(db: DB, report: Report): Report {
  run(db, "UPDATE reports SET status = 'pending' WHERE id = ? AND status = 'awaiting_reply'", report.id);
  return { ...report, status: "pending" };
}

/**
 * Claims a report for sending, so the scheduler and the turn that made it can't both send it.
 * Only one caller moves it to 'sending'; the others get false. A claim left by a sender that
 * stopped part-way is taken over after STALE_SENDING_MS.
 */
export function claimReport(db: DB, id: number, now = Date.now()): boolean {
  return run(db,
    `UPDATE reports SET status = 'sending', delivered_ts = ? WHERE id = ? AND (status IN ('pending','failed','child_not_told') OR (status = 'sending' AND COALESCE(delivered_ts, 0) < ?))`,
    now, id, now - STALE_SENDING_MS).changes > 0;
}

const MIN = 60_000;
/** Retries stop after this long; the report stays in the list as failed. */
export const RETRY_FOR_MS = 7 * 24 * 60 * MIN;
/** A pending report this old was never delivered (the server stopped first), so it's picked up. */
export const STALE_PENDING_MS = 2 * MIN;
/** A claim this old belongs to a sender that stopped part-way: it's taken over. */
export const STALE_SENDING_MS = 10 * MIN;
/** A report still waiting for her reply after this long never got one (a crash): it's sent anyway. */
export const STUCK_AWAITING_MS = 30 * MIN;
export const CHILD_NOT_TOLD_NOTE = "(Kith may not have been able to tell them first: it stopped before its reply was saved, so they may not have seen the message.)";

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
  // Told first: never while it's waiting for her reply. And only by whoever claims it.
  if (!claimReport(db, report.id, now)) return false;
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
 * Reports that never got the reply that tells her (still awaiting_reply after 30 minutes: the
 * server stopped part-way) become child_not_told, with a note for the parent, so they're still sent.
 * Logged by id only. Returns how many.
 */
export function releaseStuckReports(db: DB, now = Date.now()): number {
  const stuck = all<{ id: number }>(db, "SELECT id FROM reports WHERE status = 'awaiting_reply' AND ts < ?", now - STUCK_AWAITING_MS);
  for (const r of stuck) {
    run(db, "UPDATE reports SET status = 'child_not_told', parent_text = parent_text || ' ' || ? WHERE id = ? AND status = 'awaiting_reply'", CHILD_NOT_TOLD_NOTE, r.id);
    console.warn(`[report] report ${r.id} was never followed by the reply that tells the child; sending it with a note`);
  }
  return stuck.length;
}

/**
 * Reports to try again: failed ones from the last 7 days, ones still pending after a couple of
 * minutes (the server stopped before it could send them), child_not_told ones, and claims left by
 * a sender that stopped. Never awaiting_reply. Per-reporter backoff is applied in deliverReport,
 * so this can be called every tick.
 */
export function reportsToRetry(db: DB, now = Date.now()): Report[] {
  return all<{ id: number; ts: number; level: ReportLevel; category: string; child_notice: string; parent_text: string; status: ReportStatus }>(
    db,
    `SELECT id, ts, level, category, child_notice, parent_text, status FROM reports WHERE ts > ? AND (status IN ('failed','child_not_told')
      OR (status = 'pending' AND ts < ?) OR (status = 'sending' AND COALESCE(delivered_ts, 0) < ?)) ORDER BY ts`,
    now - RETRY_FOR_MS, now - STALE_PENDING_MS, now - STALE_SENDING_MS,
  ).map((r) => ({ id: r.id, ts: r.ts, level: r.level, category: r.category, childNotice: r.child_notice, parentText: r.parent_text, status: r.status }));
}

export function getReport(db: DB, id: number) {
  return get<{ id: number }>(db, "SELECT id FROM reports WHERE id = ?", id);
}
