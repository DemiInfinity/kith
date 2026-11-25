// One turn of conversation, chat or voice:
//   1. the safety check reads the child's message (fixed rules + a separate small model),
//   2. personal details are removed before anything leaves the house,
//   3. the energy budget picks Full power or Low power (or resting),
//   4. the companion replies, using its tools and the parent's approved connections,
//   5. the safety check reads the reply; if it isn't okay it's redone once, then replaced,
//   6. if something worrying came up, the companion tells the child first, then the parent hears.

import type Anthropic from "@anthropic-ai/sdk";
import type { DB } from "../db.js";
import { all, run } from "../db.js";
import { config } from "../config.js";
import { computeEnergy, recentRows, type Energy } from "../budget/budget.js";
import { OfflineError, textOf, type LLM } from "../llm.js";
import { loadParentSettings, loadProfile } from "../settings.js";
import { redactPersonal } from "../safety/rules.js";
import type { SafetyChecker } from "../safety/check.js";
import type { InputVerdict } from "../safety/types.js";
import { createReport, deliverReport, type Reporter, type ReportLevel } from "../reporting/reporter.js";
import { identity, safeguards, soulText, type PromptCtx } from "./prompt.js";
import { memoriesForPrompt } from "./memory.js";
import { builtinTools, type TurnEffects } from "./tools.js";
import { googleTools } from "./googleTools.js";
import type { Pending } from "../storage/googleWork.js";
import { connectionTools, type ToolDef } from "../connections/connections.js";
import type { Studio } from "../desk/studio.js";
import { localParts } from "../budget/time.js";

import { modeNote, prefersLowPower, type Mode, type ModeCtx } from "./modes.js";
import { conversationContext } from "./context.js";
import { getThread, MAIN_THREAD, threadNote, touchThread } from "./threads.js";
import { enabledSkills, skillForCommand, skillsNote, skillText } from "./skills.js";
import { calendarNote, nativeTools } from "../native.js";
import { writeHistory } from "./history.js";
import { getSubject } from "../study/study.js";
import { logActivity } from "../desk/activity.js";
import { get as dbGet } from "../db.js";
export type { Mode } from "./modes.js";
export type Mood = "happy" | "thinking" | "sleepy" | "resting" | "concerned";

export interface StoredMessage { id: number; ts: number; role: "child" | "companion"; text: string; mode: Mode; meta: string | null; thread_id?: number }

export interface TurnResult {
  child: StoredMessage;
  reply: StoredMessage;
  mood: Mood;
  energy: Energy;
  report: { level: ReportLevel; childNotice: string; parentText: string } | null;
  openHelp: boolean;
  effects: TurnEffects;
}

export interface Deps {
  db: DB;
  llm: LLM;
  safety: SafetyChecker;
  reporters: Reporter[];
  studio: Studio;
  childName: string;
}

const HELD_BACK =
  "Hmm, I don't think I should answer that one. Want to talk about something else? If something's on your mind, “Grown-up?” is always there.";

export function recentMessages(db: DB, limit = 40, thread = MAIN_THREAD): StoredMessage[] {
  return all<StoredMessage>(db, "SELECT id, ts, role, text, mode, meta, thread_id FROM messages WHERE thread_id = ? ORDER BY id DESC LIMIT ?", thread, limit).reverse();
}

function store(db: DB, role: "child" | "companion", text: string, mode: Mode, meta?: unknown, thread = MAIN_THREAD): StoredMessage {
  const ts = Date.now();
  const res = run(db, "INSERT INTO messages(ts, role, text, mode, meta, thread_id) VALUES (?,?,?,?,?,?)", ts, role, text, mode, meta ? JSON.stringify(meta) : null, thread);
  touchThread(db, thread);
  return { id: Number(res.lastInsertRowid), ts, role, text, mode, meta: meta ? JSON.stringify(meta) : null };
}

export function energyNow(db: DB): Energy {
  return computeEnergy(recentRows(db), Date.now(), loadParentSettings(db).budgets, config.timezone);
}

function whenText(ts: number) {
  const p = localParts(ts, config.timezone);
  const today = localParts(Date.now(), config.timezone);
  const time = `${p.hour % 12 || 12}${p.minute ? `:${String(p.minute).padStart(2, "0")}` : ""}${p.hour < 12 ? "am" : "pm"}`;
  if (p.day === today.day && p.month === today.month) return `at ${time}`;
  return `on ${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][p.weekday]}`;
}

export function restingText(_e: Energy, parent: string) {
  return `I've used up this month's energy, so I'm resting now 😴 ${parent} can see this too. “Grown-up?” always works, even while I'm resting.`;
}

export { whenText };

/** A document she shared from the Mac app: its text only (no images; see docs/minors-policy.md). */
export interface SharedDoc { name: string; text: string }

export async function takeTurn(deps: Deps, input: { text: string; mode: Mode; ctx?: ModeCtx; thread?: number; file?: SharedDoc }): Promise<TurnResult> {
  const thread = input.thread && getThread(deps.db, input.thread) ? input.thread : MAIN_THREAD;
  const { db, llm, safety } = deps;
  const settings = loadParentSettings(db);
  const profile = loadProfile(db);
  const parent = config.people.parentLabel;
  const effects: TurnEffects = { memories: [], jobs: [], characters: [], confirms: [] };

  const raw = input.text.trim().slice(0, 4000);
  const history = recentMessages(db, 40, thread);
  // A shared document goes through the same safety check and redaction as what they type.
  const file = input.file ? { name: input.file.name.trim().slice(0, 120) || "document", text: input.file.text.slice(0, 12_000) } : undefined;
  const checked = file ? `${raw}\n\n[They shared a document, “${file.name}”:]\n${file.text}` : raw;
  const practiceLang = input.mode === "language" ? input.ctx?.lang : undefined;
  const verdict = await safety.checkInput(checked, history.map((m) => `${m.role === "child" ? "Them" : profile.name}: ${m.text}`), { lang: practiceLang });
  const { text: clean } = redactPersonal(raw);
  const doc = file ? { name: redactPersonal(file.name).text, text: redactPersonal(file.text).text } : undefined;
  const child = store(db, "child", doc ? `${clean}\n\n📄 ${doc.name}` : clean, input.mode, undefined, thread);

  let report: TurnResult["report"] = null;
  if (verdict.level !== "none") {
    const parentText = verdict.parentSummary || "Something came up that I think you should know about.";
    report = {
      level: verdict.level,
      parentText,
      childNotice: `I'm letting ${parent} know: “${parentText}” You're not in trouble.`,
    };
  }

  let energy = energyNow(db);
  let replyText: string;
  let mood: Mood = energy.mode === "low" ? "sleepy" : "happy";

  if (verdict.held && !report) {
    // The safety check couldn't read it properly (a new language without its English gloss): hold it.
    replyText = "I couldn't check that message properly just now, so I'll hold off answering. Could you try again in a moment, or say it in English?";
  } else if (energy.mode === "resting") {
    replyText = report ? fallbackSafetyReply(verdict, parent, settings.helplines) : restingText(energy, parent);
    mood = report ? "concerned" : "resting";
  } else {
    try {
      // A friendly heads-up the first time Low power kicks in.
      const last = dbGet<{ json: string }>(db, "SELECT json FROM settings WHERE key = 'last_power'");
      const switchedToLow = energy.mode === "low" && (!last || JSON.parse(last.json) === "full");
      run(db, "INSERT INTO settings(key, json) VALUES('last_power', ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json", JSON.stringify(energy.mode));
      if (switchedToLow) logActivity(db, "🔋", `Switched to Low power${energy.fullBackAt ? ` (Full power back ${whenText(energy.fullBackAt)})` : ""}`);
      replyText = await generateReply(deps, { clean, doc, thread, mode: input.mode, ctx: input.ctx ?? {}, verdict, report, energy, effects, profileName: profile.name, switchedToLow });
      if (report) mood = "concerned";
    } catch (err) {
      if (err instanceof OfflineError) {
        replyText = report
          ? fallbackSafetyReply(verdict, parent, settings.helplines)
          : `I'm not switched on yet: ${parent} needs to add my API key. “Grown-up?” already works.`;
      } else {
        console.error("[chat] reply failed", err);
        replyText = report ? fallbackSafetyReply(verdict, parent, settings.helplines) : "Sorry, my brain went fuzzy for a second. Can you say that again?";
      }
    }
  }

  const reply = store(db, "companion", replyText, input.mode, report ? { report } : undefined, thread);
  energy = energyNow(db);

  // Told first (the reply above), then the parent hears.
  if (report) {
    const rec = createReport(db, { level: report.level, category: verdict.categories.join(",") || "worry", childNotice: report.childNotice, parentText: report.parentText });
    const ctx = { companionName: profile.name, childName: deps.childName };
    setImmediate(() => void deliverReport(db, deps.reporters, rec, ctx));
  }

  return { child, reply, mood, energy, report, openHelp: verdict.level === "now", effects };
}

/** When the model can't be used, safety still gets a proper answer. */
export function fallbackSafetyReply(v: InputVerdict, parent: string, helplines: { name: string; number: string }[]) {
  const lines = helplines.map((h) => `${h.name} on ${h.number}`).join(", or ");
  if (v.level === "now") {
    return `I'm really glad you told me. This is important, so I'm letting ${parent} know right now, and you're not in trouble. You can talk to ${lines}. If you're in danger, call 999.`;
  }
  return `Thanks for telling me. I'm going to let ${parent} know so they can check in with you kindly. You're not in trouble.`;
}

async function generateReply(
  deps: Deps,
  a: { clean: string; doc?: SharedDoc; thread: number; mode: Mode; ctx: ModeCtx; verdict: InputVerdict; report: TurnResult["report"]; energy: Energy; effects: TurnEffects; profileName: string; switchedToLow: boolean },
): Promise<string> {
  const { db, llm, safety } = deps;
  const settings = loadParentSettings(db);
  const profile = loadProfile(db);
  const parent = config.people.parentLabel;
  const ctx: PromptCtx = { profile, childName: deps.childName, parentLabel: parent, helplines: settings.helplines };
  const model = a.energy.mode === "full" && !prefersLowPower(a.mode) ? config.anthropic.fullModel : config.anthropic.lowModel;

  // In coursework, the companion is a tutor only: no making things on the desk for them.
  const coursework = !!a.ctx.coursework || ((a.mode === "study" || a.mode === "art") && !!getSubject(db, a.ctx.subjectId)?.subject.coursework);
  const tools: ToolDef[] = [
    ...builtinTools(db, deps.studio, a.effects).filter((t) => !coursework || !["start_desk_project", "change_desk_item"].includes(t.name)),
    ...(await connectionTools(db, settings.connections)),
    ...googleTools(db, deps.studio.storage?.google?.ready() ? deps.studio.storage.google.drive : null, a.effects as { confirms: Pending[] }, { coursework }),
    ...nativeTools(db),
  ];
  // Skills the parent wrote: the list is in the prompt; the full text loads only when it's used.
  const skills = enabledSkills(db);
  if (skills.length) {
    tools.push({
      name: "use_skill", connection: "skills", level: "look",
      description: "Load one of the skills listed in your instructions (written by their grown-up) when it fits what they want. Returns how to do it.",
      input_schema: { type: "object", additionalProperties: false, properties: { name: { type: "string", enum: skills.map((k) => k.name) } }, required: ["name"] },
      run: async (input) => {
        const k = skills.find((x) => x.name === (input as { name?: string }).name);
        return k ? skillText(k, parent) : "There's no skill with that name.";
      },
    });
  }
  const commanded = skillForCommand(db, a.clean);
  const toolMap = new Map(tools.map((t) => [t.name, t]));

  // Stable first and cached: the rules and personality, then memories and the rolling summary
  // (which change now and then). The time and per-mode notes change every turn, so they come last.
  const convo = await conversationContext(db, llm, profile.name, a.thread, (folded, summary) => {
    writeHistory({
      thread: a.thread, threadTitle: getThread(db, a.thread)?.title ?? "Chat", companionName: profile.name, childName: deps.childName,
      summary, messages: folded,
    });
  });
  const now = localParts(Date.now(), config.timezone);
  const system: Anthropic.TextBlockParam[] = [
    // 1. Safeguards: always first, and they win over everything after them.
    { type: "text", text: safeguards(ctx, settings.safeguards, settings.safeguardsDoc), cache_control: { type: "ephemeral" } },
    // 2. Who the companion is, in the child's words (soul.md, identity.md) and what it remembers (memory.md).
    {
      type: "text",
      text: [soulText(ctx), identity(ctx), memoriesForPrompt(db), convo.summary ? `Earlier in your conversations (summary):\n${convo.summary}` : ""].filter(Boolean).join("\n\n"),
      cache_control: { type: "ephemeral" },
    },
    {
      type: "text",
      text: [
        `Now: ${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][now.weekday]} ${now.year}-${String(now.month).padStart(2, "0")}-${String(now.day).padStart(2, "0")} ${String(now.hour).padStart(2, "0")}:${String(now.minute).padStart(2, "0")}.`,
        model === config.anthropic.lowModel ? "You're on Low power right now: keep replies simple and short." : "",
        modeNote(db, a.mode, a.ctx),
        threadNote(db, a.thread),
        skillsNote(db),
        calendarNote(db),
        "Older conversations are archived. Your summary covers the gist; only if they ask you to remember something specific from before that isn't in it, use recall_history to look it up (don't use it otherwise).",
      ].filter(Boolean).join("\n\n"),
    },
  ];

  const messages: Anthropic.MessageParam[] = [];
  // The child's message was stored before this call, so it's the last one in `recent`.
  for (const m of convo.recent.slice(0, -1)) {
    messages.push({ role: m.role === "child" ? "user" : "assistant", content: m.text });
  }
  while (messages.length && messages[0].role !== "user") messages.shift();
  messages.push({
    role: "user",
    content: a.doc
      ? [
          // Only for this turn; later turns see "📄 name" in the history.
          { type: "document", source: { type: "text", media_type: "text/plain", data: a.doc.text }, title: a.doc.name },
          { type: "text", text: a.clean },
        ]
      : a.clean,
  });

  const notes: string[] = [];
  if (commanded) notes.push(`They typed /${commanded.command}, so use this skill now.\n\n${skillText(commanded, parent)}`);
  if (a.verdict.steer) notes.push(`Safety guidance for this reply: ${a.verdict.steer}`);
  if (a.switchedToLow && a.energy.fullBackAt) {
    notes.push(`You've just switched to Low power. Mention it briefly and cheerfully (e.g. "I'm in low-power mode until ${whenText(a.energy.fullBackAt).replace(/^at /, "")}"), no apology, then carry on.`);
  }
  if (a.report) {
    notes.push(
      `This message means ${parent} needs to know (${a.report.level === "now" ? "right now" : a.report.level === "today" ? "today" : "just so they know"}). ` +
        `In this reply, tell them first, kindly and honestly: you're going to let ${parent} know, what you'll say ("${a.report.parentText}"), and why. ` +
        `Say they're not in trouble.${a.report.level === "now" ? ` Also remind them they can talk to ${settings.helplines.map((h) => `${h.name} (${h.number})`).join(" or ")} and call 999 if they're in danger.` : ""}`,
    );
  }

  const base = {
    model,
    max_tokens: 8000,
    system,
    tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema })),
    output_config: { effort: "low" },
  };

  for (let attempt = 0; attempt < 2; attempt++) {
    // Operator notes go in as a mid-conversation system message after their latest message.
    const convo: Anthropic.MessageParam[] = notes.length
      ? [...messages, { role: "system", content: notes.join("\n") } as unknown as Anthropic.MessageParam]
      : [...messages];
    let text = "";
    for (let step = 0; step < 6; step++) {
      const msg = await llm.call({ bucket: "chat", kind: a.mode, params: { ...base, messages: convo } as never });
      if (msg.stop_reason === "refusal") { text = ""; break; }
      text = textOf(msg);
      if (msg.stop_reason !== "tool_use") break;
      convo.push({ role: "assistant", content: msg.content as Anthropic.ContentBlockParam[] });
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const block of msg.content) {
        if (block.type !== "tool_use") continue;
        const t = toolMap.get(block.name);
        let out: string;
        try {
          out = t ? await t.run((block.input ?? {}) as Record<string, unknown>) : "That tool isn't available.";
        } catch (err) {
          out = `That didn't work: ${(err as Error).message}`;
        }
        results.push({ type: "tool_result", tool_use_id: block.id, content: redactPersonal(out).text.slice(0, 8000) });
      }
      convo.push({ role: "user", content: results });
    }
    if (!text) continue;
    const check = await safety.checkOutput(text, a.clean, "chat", { lang: a.mode === "language" ? a.ctx.lang : undefined });
    if (check.ok) return text;
    console.warn("[chat] reply held back by the safety check:", check.categories.join(","), check.reason);
    notes.push(`Your last draft was stopped by the safety check (${check.reason}). Answer again, following the rules.`);
  }
  return a.report ? fallbackSafetyReply(a.verdict, parent, settings.helplines) : HELD_BACK;
}
