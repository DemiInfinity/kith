// Reports to the grown-up. Pluggable: each reporter gets the same report and decides how to
// deliver it. The child is always told first (see companion/chat.ts); nothing here is secret
// from them: the child sees every report in "What <parent> sees".

import type { DB } from "../db.js";
import { all, get, run } from "../db.js";
import { config } from "../config.js";
import type { Level } from "../safety/types.js";

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

export function makeReporters(names = config.reporting.reporters): Reporter[] {
  return names.map((n) => {
    if (n === "console") return new ConsoleReporter();
    if (n === "ha-board") return new HomeAssistantBoardReporter();
    throw new Error(`Unknown reporter "${n}" in KITH_REPORTERS`);
  });
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

/** Deliver through every reporter. A failure is recorded and retried by the scheduler. */
export async function deliverReport(db: DB, reporters: Reporter[], report: Report, ctx: { companionName: string; childName: string }) {
  const results: string[] = [];
  let ok = true;
  for (const rep of reporters) {
    try {
      await rep.send(report, ctx);
      results.push(`${rep.name}: sent`);
    } catch (err) {
      ok = false;
      results.push(`${rep.name}: ${(err as Error).message}`);
    }
  }
  run(db, "UPDATE reports SET status = ?, delivered_ts = ?, delivery = ? WHERE id = ?", ok ? "delivered" : "failed", Date.now(), results.join("; "), report.id);
  return ok;
}

export function listReports(db: DB, limit = 50) {
  return all<{ id: number; ts: number; level: string; category: string; child_notice: string; parent_text: string; status: string; delivery: string | null }>(
    db, "SELECT id, ts, level, category, child_notice, parent_text, status, delivery FROM reports ORDER BY ts DESC LIMIT ?", limit,
  );
}

export function failedReports(db: DB): Report[] {
  return all<{ id: number; ts: number; level: ReportLevel; category: string; child_notice: string; parent_text: string }>(
    db, "SELECT id, ts, level, category, child_notice, parent_text FROM reports WHERE status = 'failed' AND ts > ?", Date.now() - 7 * 86_400_000,
  ).map((r) => ({ id: r.id, ts: r.ts, level: r.level, category: r.category, childNotice: r.child_notice, parentText: r.parent_text, status: "failed" }));
}

export function getReport(db: DB, id: number) {
  return get<{ id: number }>(db, "SELECT id FROM reports WHERE id = ?", id);
}
