// The companion's "files", shown on its profile: soul.md (the rules underneath everything, word
// for word as the model sees them), personality.md (what the child picked) and memory.md (what it
// remembers). Generated from the real settings, so what's shown is what's used.

import type { DB } from "../db.js";
import { config } from "../config.js";
import { loadParentSettings, loadProfile } from "../settings.js";
import { coreRules, personality, type PromptCtx } from "./prompt.js";
import { listMemories } from "./memory.js";
import { loadRolling } from "./context.js";

export function companionFiles(db: DB, childName: string) {
  const profile = loadProfile(db);
  const settings = loadParentSettings(db);
  const ctx: PromptCtx = { profile, childName, parentLabel: config.people.parentLabel, helplines: settings.helplines };

  const soul = [
    `# ${profile.name}’s soul`,
    `_The rules underneath everything, exactly as ${profile.name} is given them. Personality never changes these._`,
    coreRules(ctx)
      .replace(/\n {2}(?=\S)/g, " ") // wrapped lines belong to the bullet above
      .replace(/\b([a-z]+(?:_[a-z]+)+)\b/g, "`$1`") // tool names as code
      .split("\n")
      .map((l) => (/^[A-Z][a-z ]+$/.test(l.trim()) && !l.startsWith("-") ? `## ${l.trim()}` : l.replace(/^  /, "  ")))
      .join("\n")
      .replace(/\n(## )/g, "\n\n$1")
      .replace(/(## [^\n]+)\n/g, "$1\n\n"),
  ].join("\n\n");

  const p = profile;
  const level = (v: number, a: string, b: string) => `${a} ${"●".repeat(Math.round(v / 20))}${"○".repeat(5 - Math.round(v / 20))} ${b}`;
  const personalityMd = [
    `# ${p.name}’s personality`,
    `_Picked by ${childName || "you"}. Change it any time in Settings › Personality._`,
    `## Look\n\n${p.look}`,
    `## Traits\n\n${p.traits.map((t) => `- ${t}`).join("\n") || "- (none picked)"}`,
    `## How ${p.name} talks\n\n- ${level(p.chatty, "Calm", "Chatty")}\n- ${level(p.silly, "Serious", "Silly")}\n- ${level(p.detail, "Short answers", "Explains loads")}`,
    `## Voice\n\n${p.voice}`,
    `## Helps with\n\n${Object.entries(p.helpWith).map(([k, on]) => `- ${on ? "✓" : "✕"} ${k}`).join("\n")}`,
    `## What ${p.name} is told\n\n${personality(ctx).split("\n").slice(1).join("\n")}`,
  ].join("\n\n");

  const mems = listMemories(db);
  const rolling = loadRolling(db);
  const memoryMd = [
    `# What ${p.name} remembers`,
    `_You’re in charge: delete anything in Settings › What ${p.name} remembers. ${p.name} never keeps personal details like your address or school._`,
    `## Memories\n\n${mems.length ? mems.map((m) => `- ${m.icon} ${m.text}${m.about_date ? ` _(${m.about_date})_` : ""}`).join("\n") : "Nothing yet."}`,
    rolling?.text ? `## Our recent conversations, in short\n\n${rolling.text}` : "",
  ].filter(Boolean).join("\n\n");

  return { soul, personality: personalityMd, memory: memoryMd };
}
