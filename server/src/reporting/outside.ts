// Worries typed outside chat (a desk idea, a flashcard topic, a memory, soul.md, a scheduled
// reminder…). They're never just refused: the grown-up is told, the same way chat does it, and
// she's told first. The telling is a message from the companion in her main chat (so she sees it
// there too), saved before the report is sent; the response says the same kindly, with the
// helplines, and points her to chat.

import type { FastifyReply } from "fastify";
import type { DB } from "../db.js";
import { run } from "../db.js";
import { config } from "../config.js";
import { loadParentSettings, loadProfile } from "../settings.js";
import { checkInputRules } from "../safety/rules.js";
import type { InputCategory, InputVerdict, Level } from "../safety/types.js";
import { maxLevel } from "../safety/types.js";
import { CHECK_UNAVAILABLE, rulesSummary, type SafetyChecker } from "../safety/check.js";
import { noteSafetyUnavailable } from "../safety/unavailable.js";
import { MAIN_THREAD } from "../companion/threads.js";
import { createReport, deliverReport, markTold, type Reporter, type ReportLevel } from "./reporter.js";

/** What the rules alone count as a worry, even when the safety model said "none". */
export const WORRY_CATEGORIES: InputCategory[] = ["self_harm", "danger", "secret_from_parent", "stranger_contact"];

/** The verdict with anything the fixed rules found as a worry folded in (fail closed). */
export function withRuleWorries(v: InputVerdict, text: string): InputVerdict {
  const r = checkInputRules(text);
  const worries = r.categories.filter((c) => WORRY_CATEGORIES.includes(c));
  if (!worries.length) return v;
  const categories = [...new Set([...v.categories, ...r.categories])];
  const level: Level = maxLevel(v.level, r.level, "today");
  return { ...v, level, categories, parentSummary: v.parentSummary || rulesSummary(categories) };
}

export function isWorry(v: InputVerdict): boolean {
  return v.level !== "none";
}

function helplineText(helplines: { name: string; number: string }[]) {
  const ok = helplines.filter((h) => h.name.trim() && h.number.trim());
  return (ok.length ? ok : [{ name: "Childline", number: "0800 1111" }]);
}

export interface OutsideReport {
  code: "told-grown-up";
  error: string;
  message: string;
  level: ReportLevel;
  childNotice: string;
  helplines: { name: string; number: string }[];
  openChat: true;
}

/**
 * Makes the report for something worrying typed outside chat: recorded as awaiting_reply, the
 * telling stored in her main chat, then marked told and sent. Returns what she sees.
 */
export function reportOutsideChat(d: { db: DB; reporters: Reporter[]; childName: string }, v: InputVerdict, where: string): OutsideReport {
  const { db } = d;
  const parent = config.people.parentLabel;
  const level = (v.level === "none" ? "today" : v.level) as ReportLevel;
  const parentText = `${v.parentSummary || rulesSummary(v.categories) || "Something came up that I think you should know about."} (Typed in ${where}, not in chat.)`;
  const childNotice = `I'm letting ${parent} know: “${parentText}” You're not in trouble.`;
  const rec = createReport(db, { level, category: v.categories.join(",") || "worry", childNotice, parentText }, { awaitingReply: true });

  const helplines = helplineText(loadParentSettings(db).helplines);
  const lines = helplines.map((h) => `${h.name} on ${h.number}`).join(", or ");
  const message =
    `What you wrote sounds important, so I've passed it to ${parent} so they can check in with you kindly. You're not in trouble. ` +
    `You can talk to ${lines}${level === "now" ? ", and if you're in danger, call 999" : ""}. ` +
    `Come and talk to me in chat whenever you want.`;
  // Told first: in her chat (main thread), before anything is sent.
  run(db, "INSERT INTO messages(ts, role, text, mode, meta, thread_id) VALUES (?, 'companion', ?, 'chat', ?, ?)",
    Date.now(), message, JSON.stringify({ report: { level, childNotice, parentText }, outside: where }), MAIN_THREAD);
  const told = markTold(db, rec);
  const ctx = { companionName: loadProfile(db).name, childName: d.childName };
  setImmediate(() => void deliverReport(db, d.reporters, told, ctx).catch((err) => console.warn("[report] delivery failed", (err as Error).message)));
  return { code: "told-grown-up", error: message, message, level, childNotice, helplines, openChat: true };
}

/** Sends the outside-chat response: 422 (nothing was saved or made), with the kind words in `error`. */
export function sendOutsideReport(reply: FastifyReply, r: OutsideReport) {
  return reply.code(422).send(r);
}

/**
 * The input check for text typed outside chat. A worry is reported (and she's told, with the
 * helplines, and pointed to chat); a check that couldn't run holds it (503); content that's only
 * not allowed (romance, grown-up stuff, personal details) gets a plain 422. Returns true when the
 * text can be used. The safety model's and the fixed rules' categories both count.
 */
export async function screenInput(
  d: { db: DB; reporters: Reporter[]; safety: SafetyChecker; childName: string },
  reply: FastifyReply,
  text: string,
  where: string,
  refuse: { categories: InputCategory[]; message: (found: InputCategory[]) => string },
): Promise<boolean> {
  if (!text.trim()) return true;
  const v = withRuleWorries(await d.safety.checkInput(text, []), text);
  if (isWorry(v)) { sendOutsideReport(reply, reportOutsideChat(d, v, where)); return false; }
  if (v.held) {
    noteSafetyUnavailable(d.db, { companionName: loadProfile(d.db).name, childName: d.childName }, d.reporters);
    reply.code(503).send({ error: CHECK_UNAVAILABLE, code: "safety-unavailable" });
    return false;
  }
  const found = [...new Set([...checkInputRules(text).categories, ...v.categories])].filter((c) => refuse.categories.includes(c));
  if (found.length) { reply.code(422).send({ error: refuse.message(found) }); return false; }
  return true;
}
