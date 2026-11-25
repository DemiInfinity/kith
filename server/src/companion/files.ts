// The companion's files on its profile, all the child's to shape:
//   soul.md      who it is, in the child's own words (editable)
//   identity.md  name, look, traits, how it talks and voice (Personality settings) plus their notes (editable)
//   memory.md    what it remembers (they can add and delete)
// None of these hold safeguards. The safeguards are a separate document, always first in the prompt,
// that nothing here can override; the parent sees it and can add family safeguards (parent view).

import type { DB } from "../db.js";
import { config } from "../config.js";
import { loadParentSettings, loadProfile } from "../settings.js";
import { DEFAULT_SOUL, safeguards, type PromptCtx } from "./prompt.js";
import { listMemories } from "./memory.js";
import { loadRolling } from "./context.js";

function ctxFor(db: DB, childName: string): PromptCtx {
  return { profile: loadProfile(db), childName, parentLabel: config.people.parentLabel, helplines: loadParentSettings(db).helplines };
}

export function companionFiles(db: DB, childName: string) {
  const p = loadProfile(db);
  const level = (v: number, a: string, b: string) => `${a} ${"●".repeat(Math.round(v / 20))}${"○".repeat(5 - Math.round(v / 20))} ${b}`;

  const identity = [
    `# ${p.name}`,
    `**Look:** ${p.look} · **Voice:** ${p.voice}`,
    `**Traits:** ${p.traits.join(", ") || "(none picked)"}`,
    `- ${level(p.chatty, "Calm", "Chatty")}\n- ${level(p.silly, "Serious", "Silly")}\n- ${level(p.detail, "Short answers", "Explains loads")}`,
    `**Helps with:** ${Object.entries(p.helpWith).filter(([, on]) => on).map(([k]) => k).join(", ") || "anything everyday"}`,
  ].join("\n\n");

  const mems = listMemories(db);
  const rolling = loadRolling(db);
  return {
    soul: p.soul.trim() || DEFAULT_SOUL(p.name),
    soulIsDefault: !p.soul.trim(),
    identity,
    identityNotes: p.identityNotes,
    memories: mems.map((m) => ({ id: m.id, icon: m.icon, text: m.text, date: m.about_date })),
    summary: rolling?.text ?? "",
    childName,
  };
}

/** For the parent view: the built-in safeguards (read-only) and the family ones they've added. */
export function safeguardsDoc(db: DB, childName: string) {
  const ctx = ctxFor(db, childName);
  return { builtIn: safeguards(ctx, ""), family: loadParentSettings(db).safeguards };
}
