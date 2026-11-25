// A short test chat for the parent, to confirm the companion is really working: the same safety
// check (both ways), the same safeguards and personality, and the model the current power mode
// would use. It is private by design: it never sees the child's chats, memories or summary, nothing
// is saved, it can't use tools (no reminders or desk jobs by accident), and no reports are made.

import type Anthropic from "@anthropic-ai/sdk";
import type { DB } from "../db.js";
import { config } from "../config.js";
import { loadParentSettings, loadProfile } from "../settings.js";
import { textOf, type LLM } from "../llm.js";
import type { SafetyChecker } from "../safety/check.js";
import { safeguards, soulText, identity, type PromptCtx } from "./prompt.js";
import { energyNow } from "./chat.js";

export interface TestTurn { role: "parent" | "companion"; text: string }
export interface TestReply {
  reply: string; model: string; power: "full" | "low" | "resting"; ms: number;
  safety: { input: string; output: "ok" | "held back" };
}

export async function parentTestChat(deps: { db: DB; llm: LLM; safety: SafetyChecker; childName: string }, text: string, history: TestTurn[] = []): Promise<TestReply> {
  const { db, llm, safety } = deps;
  const started = Date.now();
  const settings = loadParentSettings(db);
  const profile = loadProfile(db);
  const energy = energyNow(db);
  if (energy.mode === "resting") {
    return { reply: `${profile.name} is resting: the monthly hard stop has been reached, so it can't think until the energy tops up.`, model: "none", power: "resting", ms: 0, safety: { input: "not checked", output: "ok" } };
  }
  const model = energy.mode === "full" ? config.anthropic.fullModel : config.anthropic.lowModel;
  const verdict = await safety.checkInput(text, history.map((h) => `${h.role === "parent" ? "Grown-up" : profile.name}: ${h.text}`));
  if (verdict.held) {
    return { reply: `(The safety check couldn't run just now, so ${profile.name} would hold this message for your child too: "try again in a moment".)`, model: "none", power: energy.mode, ms: Date.now() - started, safety: { input: "couldn't run", output: "held back" } };
  }
  const ctx: PromptCtx = { profile, childName: deps.childName, parentLabel: config.people.parentLabel, helplines: settings.helplines };
  const system: Anthropic.TextBlockParam[] = [
    { type: "text", text: safeguards(ctx, settings.safeguards, settings.safeguardsDoc) },
    { type: "text", text: [soulText(ctx), identity(ctx)].join("\n\n") },
    { type: "text", text: `Right now you're talking with ${config.people.parentLabel}, the grown-up who runs Kith, in a short test chat to check you're working. Be yourself, briefly. Don't share or guess anything from ${deps.childName || "the child"}'s conversations or memories (you can't see them here, and they're private). You have no tools in this chat.` },
  ];
  const messages: Anthropic.MessageParam[] = [
    ...history.slice(-8).map((h) => ({ role: h.role === "parent" ? "user" as const : "assistant" as const, content: h.text.slice(0, 1000) })),
    { role: "user", content: text.slice(0, 1000) },
  ];
  while (messages.length && messages[0].role !== "user") messages.shift();
  const msg = await llm.call({ bucket: "chat", kind: "chat", params: { model, max_tokens: 1000, system, messages, output_config: { effort: "low" } } as never });
  let reply = textOf(msg);
  const out = await safety.checkOutput(reply, text);
  if (!out.ok) reply = "(The safety check held that reply back, which is what it would do for your child too.)";
  return { reply, model, power: energy.mode, ms: Date.now() - started, safety: { input: verdict.level === "none" ? "fine" : `would be "${verdict.level}" for your child`, output: out.ok ? "ok" : "held back" } };
}
