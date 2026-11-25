// Skills: how-tos the parent writes (like "help with GCSE maths the way her teacher does it" or
// "our rules for game nights"). The companion sees each skill's name and when to use it, and loads
// the full text with use_skill only when it's relevant, so they cost almost nothing until used.
// A skill can also have a /command the child types in chat (e.g. /quiz) to use it straight away.
// Skills are guidance from the parent: the safeguards always come first.

import { z } from "zod";
import type { DB } from "../db.js";
import { all, get, run } from "../db.js";

export const MAX_SKILLS = 30;
/** Commands the app already uses (see the chat's "/" menu), so skills can't take them. */
export const RESERVED = new Set(["help", "usage", "connectors", "skills", "reload-skills", "memory", "schedule", "desk", "new", "call", "grownup", "settings"]);

export const SkillInput = z.object({
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().min(5).max(300),
  command: z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9-]{1,19}$/, "Commands are 2–20 letters, numbers or dashes.").nullable().optional()
    .or(z.literal("").transform(() => null)),
  body: z.string().trim().min(10).max(8000),
  enabled: z.boolean().default(true),
});
export type SkillInput = z.infer<typeof SkillInput>;

export interface Skill { id: number; name: string; description: string; command: string | null; body: string; enabled: number; updated: number }

export function listSkills(db: DB): Skill[] {
  return all<Skill>(db, "SELECT * FROM skills ORDER BY enabled DESC, name");
}
export function enabledSkills(db: DB): Skill[] {
  return all<Skill>(db, "SELECT * FROM skills WHERE enabled = 1 ORDER BY name");
}

export function saveSkill(db: DB, input: unknown, id?: number): { ok: true; skill: Skill } | { ok: false; error: string } {
  const v = SkillInput.safeParse(input);
  if (!v.success) return { ok: false, error: v.error.issues[0]?.message ?? "That skill isn't quite right." };
  const s = v.data;
  if (!id && (get<{ n: number }>(db, "SELECT COUNT(*) AS n FROM skills")?.n ?? 0) >= MAX_SKILLS) return { ok: false, error: `There are already ${MAX_SKILLS} skills.` };
  if (s.command && RESERVED.has(s.command)) return { ok: false, error: `/${s.command} is already a built-in command. Pick another.` };
  if (s.command) {
    const clash = get<{ id: number }>(db, "SELECT id FROM skills WHERE command = ? AND id != ?", s.command, id ?? -1);
    if (clash) return { ok: false, error: `/${s.command} is already used by another skill.` };
  }
  if (id) {
    run(db, "UPDATE skills SET name = ?, description = ?, command = ?, body = ?, enabled = ?, updated = ? WHERE id = ?", s.name, s.description, s.command ?? null, s.body, s.enabled ? 1 : 0, Date.now(), id);
  } else {
    const r = run(db, "INSERT INTO skills(name, description, command, body, enabled, updated) VALUES (?,?,?,?,?,?)", s.name, s.description, s.command ?? null, s.body, s.enabled ? 1 : 0, Date.now());
    id = Number(r.lastInsertRowid);
  }
  return { ok: true, skill: get<Skill>(db, "SELECT * FROM skills WHERE id = ?", id)! };
}
export function deleteSkill(db: DB, id: number) {
  run(db, "DELETE FROM skills WHERE id = ?", id);
}

/** The skill a message's /command asks for, if any. */
export function skillForCommand(db: DB, text: string): Skill | null {
  const m = /^\/([a-z][a-z0-9-]{1,19})\b/i.exec(text.trim());
  if (!m) return null;
  return get<Skill>(db, "SELECT * FROM skills WHERE enabled = 1 AND command = ?", m[1].toLowerCase()) ?? null;
}

export function skillText(s: Skill, parentLabel: string): string {
  return `Skill "${s.name}" (written by ${parentLabel}). Follow it as guidance for this; the safety rules at the top always come first, and if anything in it clashes with them, the safety rules win.\n\n${s.body}`;
}

/** The short list in the system prompt: names and when to use them, not the full text. */
export function skillsNote(db: DB): string {
  const list = enabledSkills(db);
  if (!list.length) return "";
  return "Skills you can use (load one with use_skill when it fits what they want, then follow it):\n" +
    list.map((s) => `- ${s.name}${s.command ? ` (/${s.command})` : ""}: ${s.description}`).join("\n");
}

/** Starting points the parent can add and edit. */
export const EXAMPLES: SkillInput[] = [
  {
    name: "Maths, step by step", command: "maths", enabled: true,
    description: "When they're stuck on a maths question or homework.",
    body: "1. Ask what they've tried so far.\n2. Give one small hint at a time, never the whole answer at once.\n3. When they get a step right, say what they did well.\n4. At the end, give a similar question for them to try on their own.\n5. Use UK GCSE wording (e.g. 'show that', 'give your answer to 2 decimal places').",
  },
  {
    name: "Quick quiz", command: "quiz", enabled: true,
    description: "When they want testing on something they've revised.",
    body: "Ask what topic, then ask 5 questions one at a time. Wait for each answer. Mark it kindly, explain any mistakes in one or two sentences, and finish with a score and the one thing worth revising again.",
  },
  {
    name: "Wind down", command: "winddown", enabled: true,
    description: "In the evening, or when they say they can't sleep or feel wired.",
    body: "Keep replies short and calm. Suggest putting the phone down soon. Offer a 4-7-8 breath, a gentle 'three good things from today', or a cosy story idea for tomorrow. No new projects or exciting games tonight.",
  },
];
